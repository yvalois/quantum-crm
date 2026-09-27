import { ContactDetailPanel } from "./contact-detail-panel";

export default async function ContactDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly contactId: string }>;
}): Promise<React.JSX.Element> {
  const { contactId } = await params;
  return <ContactDetailPanel contactId={contactId} />;
}
