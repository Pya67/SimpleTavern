import { Suspense } from "react";
import { PresetsView } from "./presets-view";

export const metadata = { title: "Presets & prompts" };

export default function Page() {
  return (
    <Suspense>
      <PresetsView />
    </Suspense>
  );
}
