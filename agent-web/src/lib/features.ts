export const featureFlags = Object.freeze({
  account: process.env.NEXT_PUBLIC_ENABLE_ACCOUNT === "true",
  discovery: process.env.NEXT_PUBLIC_ENABLE_DISCOVERY === "true",
  projects: process.env.NEXT_PUBLIC_ENABLE_PROJECTS === "true",
  assets: process.env.NEXT_PUBLIC_ENABLE_ASSETS === "true",
  chat: process.env.NEXT_PUBLIC_ENABLE_CHAT === "true",
  image: process.env.NEXT_PUBLIC_ENABLE_IMAGE === "true",
  copywriting: process.env.NEXT_PUBLIC_ENABLE_COPYWRITING === "true",
  media: process.env.NEXT_PUBLIC_ENABLE_MEDIA === "true",
  experimental: process.env.NEXT_PUBLIC_ENABLE_EXPERIMENTAL === "true",
  agency: process.env.NEXT_PUBLIC_ENABLE_AGENCY === "true",
  plugins: process.env.NEXT_PUBLIC_ENABLE_PLUGINS === "true",
  referrals: process.env.NEXT_PUBLIC_ENABLE_REFERRALS === "true",
  oauth: process.env.NEXT_PUBLIC_ENABLE_OAUTH === "true",
  mockPayment:
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_ENABLE_MOCK_PAYMENT === "true",
});

export type WebFeature = keyof typeof featureFlags;

const publicRoutes = new Set(["/", "/register", "/terms", "/privacy", "/account-rules"]);

const routeRules: ReadonlyArray<{
  routes: readonly string[];
  feature: WebFeature;
}> = [
  { routes: ["/pricing", "/settings"], feature: "account" },
  { routes: ["/inspiration", "/templates", "/tools"], feature: "discovery" },
  { routes: ["/projects", "/recent"], feature: "projects" },
  { routes: ["/assets"], feature: "assets" },
  { routes: ["/chat"], feature: "chat" },
  {
    routes: [
      "/generate",
      "/image",
      "/canvas",
      "/collage",
      "/editor",
      "/resize",
      "/id-photo",
      "/batch-edit",
      "/product-photo",
      "/cutout",
      "/eraser",
      "/expand",
      "/upscale",
      "/poster",
      "/portrait",
    ],
    feature: "image",
  },
  { routes: ["/copywriting"], feature: "copywriting" },
  { routes: ["/video", "/music"], feature: "media" },
  { routes: ["/a-plus", "/coming-soon", "/more"], feature: "experimental" },
  { routes: ["/agent"], feature: "agency" },
  { routes: ["/plugins"], feature: "plugins" },
  { routes: ["/referral"], feature: "referrals" },
  { routes: ["/auth/callback"], feature: "oauth" },
];

const matchesRoute = (pathname: string, route: string) =>
  pathname === route || pathname.startsWith(`${route}/`);

export function isWebRouteEnabled(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0] || "/";
  if (publicRoutes.has(pathname)) return true;

  const rule = routeRules.find(({ routes }) =>
    routes.some((route) => matchesRoute(pathname, route))
  );
  return rule ? featureFlags[rule.feature] : false;
}
