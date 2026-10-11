import { redirect } from "next/navigation";

// Groups were removed: there is one market. Old /split links land on it.
export default function SplitRedirect() {
  redirect("/cohorts");
}
