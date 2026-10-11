import { isAdminAuthenticated } from "@/lib/admin/session";
import SiteHeader from "./site-header";

export default async function SiteHeaderServer() {
  const isAdmin = await isAdminAuthenticated();
  return <SiteHeader isAdmin={isAdmin} />;
}
