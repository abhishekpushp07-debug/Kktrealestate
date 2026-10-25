import type { StepErrors, WizardState } from "../bookingMath";

/** Props every wizard step receives. */
export interface StepProps {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  /** Validation of this step (always computed). */
  errors: StepErrors;
  /** Show inline errors (after the user tried to continue). */
  showErrors: boolean;
  /** Permissions the steps care about. */
  can: { editAgreement: boolean; writeCustomer: boolean; uploadDocument: boolean };
}
