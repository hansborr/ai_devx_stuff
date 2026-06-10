export async function loader(): Promise<{ readonly campaignId: string }> {
  return { campaignId: "fixture-campaign" };
}

export const handle = {
  title: "Campaign detail",
  requiredRole: "dm",
};

export default function CampaignRoute() {
  return <section data-route="campaign-detail">Campaign detail</section>;
}
