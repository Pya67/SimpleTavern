import { Suspense } from "react";
import { CharactersView } from "./characters-view";

export const metadata = { title: "Characters" };

export default function Page() {
  return (
    <Suspense>
      <CharactersView />
    </Suspense>
  );
}
