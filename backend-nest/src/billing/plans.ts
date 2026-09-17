export const PLANS = [
  {
    tier: 'starter',
    name: 'Starter',
    limits: {
      max_projects: 3,
      max_seats: 3,
      ai_agent_swarm: false,
      unlimited_traces: false,
      dedicated_clerk_sso: false,
      sla_support: false,
    },
  },
  {
    tier: 'growth',
    name: 'Growth',
    limits: {
      max_projects: 20,
      max_seats: 10,
      ai_agent_swarm: true,
      unlimited_traces: false,
      dedicated_clerk_sso: true,
      sla_support: false,
    },
  },
  {
    tier: 'enterprise',
    name: 'Enterprise',
    limits: {
      max_projects: 100,
      max_seats: 50,
      ai_agent_swarm: true,
      unlimited_traces: true,
      dedicated_clerk_sso: true,
      sla_support: true,
    },
  },
];

export function limitsForTier(tier: string) {
  const plan = PLANS.find((p) => p.tier === tier) || PLANS[0];
  return plan.limits;
}
