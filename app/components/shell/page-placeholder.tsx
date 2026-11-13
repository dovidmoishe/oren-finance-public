import { AppShell } from "./app-shell";
import { Card, CardContent } from "@/components/ui";

export function PagePlaceholder({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <AppShell>
      <div className="mx-auto max-w-5xl">
        <p className="text-sm text-muted">{eyebrow}</p>
        <h1 className="mt-1 font-display text-4xl font-semibold tracking-normal">{title}</h1>
        <Card className="mt-6">
          <CardContent>
            <p className="max-w-2xl text-sm leading-6 text-muted">{description}</p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
