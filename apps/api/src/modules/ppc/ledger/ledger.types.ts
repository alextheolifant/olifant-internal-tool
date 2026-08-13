export type LedgerSource = 'engine' | 'external';
export type LedgerCategory = 'bulk_operation' | 'amazon_recommendation' | 'manual';

export interface NewLedgerEntry {
  clientId: string;
  profile: string | null;
  timestampDetected: Date;
  entityType: string;
  entityId: string;
  campaignName: string | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  source: LedgerSource;
  taskId: string | null;
  actor: string | null;
  note: string | null;
  category: LedgerCategory | null;
}
