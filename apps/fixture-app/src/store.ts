export interface Seat {
  email: string;
  role: "admin" | "member";
  status: "active" | "invited";
}

export interface BillingAddress {
  line1: string;
  city: string;
  postal: string;
}

export interface FixtureState {
  plan: "growth" | "scale";
  billing: BillingAddress;
  seats: Seat[];
  profile: { fullName: string; email: string; productUpdates: boolean };
}

export function seedState(): FixtureState {
  return {
    plan: "growth",
    billing: { line1: "1 Harbour Lane", city: "Rotterdam", postal: "3011 AA" },
    seats: [
      { email: "dana@example.com", role: "admin", status: "active" },
      { email: "kim@example.com", role: "member", status: "active" },
    ],
    profile: { fullName: "Dana Operator", email: "dana@example.com", productUpdates: true },
  };
}

export class FixtureStore {
  private state: FixtureState = seedState();

  snapshot(): FixtureState {
    return structuredClone(this.state);
  }

  reset(): void {
    this.state = seedState();
  }

  saveBilling(billing: BillingAddress): void {
    this.state.billing = billing;
  }

  invite(email: string): void {
    if (this.state.seats.some((seat) => seat.email === email)) return;
    this.state.seats.push({ email, role: "member", status: "invited" });
  }

  saveProfile(fullName: string, email: string, productUpdates: boolean): void {
    this.state.profile = { fullName, email, productUpdates };
  }

  switchPlan(): void {
    this.state.plan = this.state.plan === "growth" ? "scale" : "growth";
  }
}
