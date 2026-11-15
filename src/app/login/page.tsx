import { Suspense } from "react";
import { LoginView } from "@/components/auth/AuthViews";

export const metadata = { title: "Entrar · Reforesta Radar" };

export default function Page() {
  return (
    <Suspense>
      <LoginView />
    </Suspense>
  );
}
