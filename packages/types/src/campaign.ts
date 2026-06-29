export interface Campaign {
  id: string;
  clientId: string;
  amazonCampaignId: string;
  name: string;
  state: 'enabled' | 'paused' | 'archived';
  budget: number;
  createdAt: Date;
  updatedAt: Date;
}
