import { redirect } from "next/navigation";

export default function DepositPage() {
  redirect("/app?deposit=1");
}
