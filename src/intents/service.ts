import { randomBytes, randomUUID } from "node:crypto";

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
    const externalReference = input.externalReference.trim();
    if (externalReference.length === 0 || externalReference.length > 512) {
      throw new Error("externalReference must contain between 1 and 512 characters");
    }
    if (!isPositiveAtomicAmount(input.amountAtomic)) {
      throw new Error("amountAtomic must be a positive base-10 integer");
    }
    if (BigInt(input.amountAtomic) > MaxUint256) {
      throw new Error("amountAtomic exceeds uint256");
    }
    if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now) {
      throw new Error("expiresAt must be a future Unix timestamp in seconds");
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
    this.database.transaction(() => this.database.insertIntent(record));
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
