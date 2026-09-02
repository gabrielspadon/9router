import { getMachineId } from "@/shared/utils/machine";
import EndpointPageClient from "./endpoint/EndpointPageClient";

// The shell answers the system-health question on every dashboard route. Home
// keeps the next question, which endpoint should a client use.
//
// The endpoint content stays exactly where it was rather than moving, so no
// bookmark breaks and nothing becomes a click deeper.
export default async function DashboardPage() {
  const machineId = await getMachineId();
  return <EndpointPageClient machineId={machineId} />;
}
