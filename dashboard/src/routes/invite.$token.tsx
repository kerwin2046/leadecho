import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { acceptInvite, getInviteDetails } from "@/lib/api";

export const Route = createFileRoute("/invite/$token")({
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: invite, isLoading, isError } = useQuery({
    queryKey: ["invite", token],
    queryFn: () => getInviteDetails(token),
    retry: false,
  });

  useEffect(() => {
    if (invite?.accepted) {
      navigate({ to: "/login" });
    }
  }, [invite, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      await acceptInvite(token, { name, password });
      window.location.href = "/app/inbox";
    } catch (err: any) {
      setError(err.message || "Failed to accept invitation");
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Text as="p" className="text-muted-foreground">Loading invitation...</Text>
      </div>
    );
  }

  if (isError || !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center">
          <Text as="h1" className="mb-2">Invitation not found</Text>
          <Text as="p" className="text-sm text-muted-foreground mb-6">
            This invitation may have been revoked or never existed.
          </Text>
          <a href="/app/login">
            <Button variant="outline">Go to login</Button>
          </a>
        </div>
      </div>
    );
  }

  if (invite.expired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center">
          <Text as="h1" className="mb-2">Invitation expired</Text>
          <Text as="p" className="text-sm text-muted-foreground mb-6">
            This invitation has passed its 7-day validity window. Ask your admin to resend it.
          </Text>
          <a href="/app/login">
            <Button variant="outline">Go to login</Button>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="font-[family-name:var(--font-head)] text-3xl">LeadEcho</span>
        </div>
        <div className="border-2 border-border bg-card p-8 shadow-lg">
          <Text as="h1" className="mb-2">You're invited</Text>
          <Text as="p" className="text-sm text-muted-foreground mb-6">
            Accepting as <strong className="text-foreground">{invite.email}</strong> with role{" "}
            <strong className="text-foreground">{invite.role}</strong>.
          </Text>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              type="text"
              placeholder="Your full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <Input
              type="password"
              placeholder="Choose a password (min 8 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
            {error && (
              <Text as="p" className="text-xs text-destructive">{error}</Text>
            )}
            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? "Accepting..." : "Accept & Join Workspace"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
