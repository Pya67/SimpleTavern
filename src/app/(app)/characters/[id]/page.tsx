import { CharacterEditor } from "@/components/editors/character-editor";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CharacterEditor key={id} id={id} />;
}
