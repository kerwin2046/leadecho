import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { getSetupStatus, setupWorkspace } from "@/lib/api";

export const Route = createFileRoute("/_auth/setup")({
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["setup-status"],
    queryFn: getSetupStatus,
    retry: false,
  });

  useEffect(() => {
    if (!statusLoading && status && !status.setup_required) {
      navigate({ to: "/login" });
    }
  }, [status, statusLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      await setupWorkspace({
        email,
        password,
        name,
        workspace_name: workspace || undefined,
      });
      window.location.href = "/app/inbox";
    } catch (err: any) {
      setError(err.message || "Setup failed");
    } finally {
      setLoading(false);
    }
  };

  if (statusLoading) return null;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Set up your workspace</CardTitle>
        <CardDescription>
          Create the first admin account. After this, joining is invite-only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            type="text"
            placeholder="Workspace name (e.g. Acme Marketing)"
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
          />
          <Input
            type="text"
            placeholder="Your full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            type="email"
            placeholder="Admin email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          {error && (
            <Text as="p" className="text-xs text-destructive">
              {error}
            </Text>
          )}
          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={loading}
          >
            {loading ? "Setting up workspace..." : "Create Workspace"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        <Text as="p" className="text-xs text-muted-foreground text-center">
          Already set up?{" "}
          <Link to="/login" className="underline hover:text-foreground">
            Sign in
          </Link>
        </Text>
      </CardFooter>
    </Card>
  );
}
