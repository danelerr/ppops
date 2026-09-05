import { createHash, randomBytes, randomUUID } from "node:crypto";

import { MaxUint256, Wallet, getAddress } from "ethers";

import type { PPOpsConfig } from "../config.js";
import {
  type PaymentIntentView,
  type SignedPaymentDescriptorV1,
  isPositiveAtomicAmount,
} from "../domain.js";
import type { PPOpsDatabase } from "../db/database.js";
import {
  createSignedDescriptor,
  verifySignedDescriptor,
} from "../security/descriptor.js";

export type CreateIntentInput = {
  externalReference: string;
  amountAtomic: string;
  expiresAt: number;
};

export class IdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key was already used with a different request");
    this.name = "IdempotencyConflictError";
  }
}

export class IntentInputError extends Error {
  constructor(readonly field: keyof CreateIntentInput, message: string) {
    super(message);
    this.name = "IntentInputError";
  }
}

const fingerprintFor = (input: CreateIntentInput): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        externalReference: input.externalReference.trim(),
        amountAtomic: input.amountAtomic,
        expiresAt: input.expiresAt,
      }),
    )
    .digest("hex");

export class IntentService {
  readonly merchantSigner: string;

  constructor(
    private readonly database: PPOpsDatabase,
    private readonly network: PPOpsConfig["network"],
    private readonly recipient0zk: string,
    private readonly merchantPrivateKey: string,
  ) {
    this.merchantSigner = new Wallet(merchantPrivateKey).address;
  }

  async create(input: CreateIntentInput, now = Math.floor(Date.now() / 1_000)):
  Promise<PaymentIntentView> {
    const result = await this.createRecord(input, now);
    if (typeof result === "string") {
      throw new Error("Non-idempotent intent creation unexpectedly replayed");
    }
    return result;
  }

  async createIdempotent(
    input: CreateIntentInput,
    idempotencyKey: string,
    now = Math.floor(Date.now() / 1_000),
  ): Promise<{ intent: PaymentIntentView; replayed: boolean }> {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      throw new Error("Invalid idempotency key");
    }
    const fingerprint = fingerprintFor(input);
    const storageKey = createHash("sha256").update(idempotencyKey).digest("hex");
    const existing = this.database.getIntentIdempotency(storageKey);
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new IdempotencyConflictError();
      }
      return { intent: this.requireView(existing.intentId), replayed: true };
    }
    const result = await this.createRecord(input, now, {
      idempotencyKey: storageKey,
      fingerprint,
    });
    return typeof result === "string"
      ? { intent: this.requireView(result), replayed: true }
      : { intent: result, replayed: false };
  }

  private async createRecord(
    input: CreateIntentInput,
    now: number,
    idempotency?: { idempotencyKey: string; fingerprint: string },
  ): Promise<PaymentIntentView | string> {
    const externalReference = input.externalReference.trim();
    if (externalReference.length === 0 || externalReference.length > 512) {
      throw new IntentInputError("externalReference", "Use between 1 and 512 non-blank characters.");
    }
    if (!isPositiveAtomicAmount(input.amountAtomic)) {
      throw new IntentInputError("amountAtomic", "Use a positive integer string in token atomic units.");
    }
    if (BigInt(input.amountAtomic) > MaxUint256) {
      throw new IntentInputError("amountAtomic", "The amount must fit in uint256.");
    }
    if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now) {
      throw new IntentInputError("expiresAt", "Use a future Unix timestamp in seconds, not milliseconds.");
    }

    const reference = `0x${randomBytes(32).toString("hex")}`;
    const descriptor = await createSignedDescriptor(
      {
        chainId: this.network.chainId,
        tokenAddress: this.network.tokenAddress,
        decimals: this.network.tokenDecimals,
        amountAtomic: input.amountAtomic,
        recipient0zk: this.recipient0zk,
        reference,
        expiresAt: input.expiresAt,
      },
      this.merchantPrivateKey,
    );
    verifySignedDescriptor(descriptor, this.merchantSigner);

    const createdAt = now;
    const record = {
      id: `pi_${randomUUID().replaceAll("-", "")}`,
      externalReference,
      reference,
      chainId: this.network.chainId,
      tokenAddress: getAddress(this.network.tokenAddress),
      tokenSymbol: this.network.tokenSymbol,
      decimals: this.network.tokenDecimals,
      expectedAmountAtomic: input.amountAtomic,
      recipient0zk: this.recipient0zk,
      expiresAt: input.expiresAt,
      descriptor,
      createdAt,
    };
    const existingIntentId = this.database.transaction(() => {
      if (idempotency) {
        const existing = this.database.getIntentIdempotency(idempotency.idempotencyKey);
        if (existing) {
          if (existing.requestFingerprint !== idempotency.fingerprint) {
            throw new IdempotencyConflictError();
          }
          return existing.intentId;
        }
      }
      this.database.insertIntent(record);
      if (idempotency) {
        this.database.insertIntentIdempotency(
          idempotency.idempotencyKey,
          idempotency.fingerprint,
          record.id,
          createdAt,
        );
      }
      return undefined;
    });
    if (existingIntentId) return existingIntentId;
    return this.requireView(record.id);
  }

  get(id: string): PaymentIntentView | undefined {
    const intent = this.database.getIntent(id);
    if (!intent) return undefined;
    const projection = this.database.getProjection(id);
    if (!projection) throw new Error(`Missing projection for payment intent ${id}`);
    return { ...intent, ...projection };
  }

  requireView(id: string): PaymentIntentView {
    const intent = this.get(id);
    if (!intent) throw new Error(`Payment intent not found: ${id}`);
    return intent;
  }

  list(limit = 100, offset = 0): PaymentIntentView[] {
    return this.database.listIntents(limit, offset).map((intent) => {
      const projection = this.database.getProjection(intent.id);
      if (!projection) throw new Error(`Missing projection for payment intent ${intent.id}`);
      return { ...intent, ...projection };
    });
  }

  verifyDescriptor(
    descriptor: SignedPaymentDescriptorV1,
    now = Math.floor(Date.now() / 1_000),
  ): string {
    const recovered = verifySignedDescriptor(descriptor, this.merchantSigner);
    const matchesInstance =
      descriptor.chainId === this.network.chainId &&
      descriptor.tokenAddress.toLowerCase() === this.network.tokenAddress.toLowerCase() &&
      descriptor.decimals === this.network.tokenDecimals &&
      descriptor.recipient0zk === this.recipient0zk;
    if (!matchesInstance) {
      throw new Error("Descriptor does not match this PPOps instance profile");
    }
    if (descriptor.expiresAt <= now) throw new Error("Descriptor is expired");
    return recovered;
  }
}
