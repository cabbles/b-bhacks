import { redirect } from "next/navigation";

// Old links (QR codes, slides) land on the integrity page.
export default function FoolRedirect() {
  redirect("/integrity");
}
