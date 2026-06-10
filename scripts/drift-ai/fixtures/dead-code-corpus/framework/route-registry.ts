type RouteRegistration = {
  readonly routeId: string;
  readonly load: () => Promise<unknown>;
};

const registeredRoutes: RouteRegistration[] = [];

export function registerRouteModule(routeId: string, load: () => Promise<unknown>): void {
  registeredRoutes.push({ routeId, load });
}

registerRouteModule("campaign.detail", () => import("./routes/campaign-route"));

export function registeredRouteIds(): string[] {
  return registeredRoutes.map((route) => route.routeId).sort();
}
