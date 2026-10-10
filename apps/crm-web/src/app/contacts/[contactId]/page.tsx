import { redirect } from "next/navigation";

export default async function ContactDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly contactId: string }>;
}): Promise<never> {
  const { contactId } = await params;
  redirect(`/contacts?contact=${encodeURIComponent(contactId)}`);
}
