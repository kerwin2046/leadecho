import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import {
  createInvite,
  listInvites,
  listMembers,
  revokeInvite,
} from "@/lib/api";
import type { InviteRow, MemberRow, UserRole } from "@/lib/types";
import { UserPlus, Trash2, Copy, Check, Mail, Shield, Eye, Pencil } from "lucide-react";

export const Route = createFileRoute("/_dashboard/members")({
  component: MembersPage,
});

const roleMeta: Record<UserRole, { label: string; icon: typeof Shield; color: string }> = {
  admin: { label: "Admin", icon: Shield, color: "bg-primary text-primary-foreground" },
  editor: { label: "Editor", icon: Pencil, color: "bg-muted text-foreground" },
  viewer: { label: "Viewer", icon: Eye, color: "bg-muted text-muted-foreground" },
};

function MembersPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("viewer");
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ["members"],
    queryFn: listMembers,
  });

  const { data: invites, isLoading: invitesLoading } = useQuery({
    queryKey: ["invites"],
    queryFn: listInvites,
    enabled: isAdmin,
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      createInvite({ email: inviteEmail, role: inviteRole }),
    onSuccess: () => {
      setInviteEmail("");
      setInviteRole("viewer");
      queryClient.invalidateQueries({ queryKey: ["invites"] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeInvite(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["invites"] }),
  });

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 1500);
  };

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto">
        <Text as="h1" className="mb-4">Members</Text>
        <Card>
          <CardContent className="p-6">
            <Text as="p" className="text-sm text-muted-foreground">
              Only workspace admins can manage members and invitations. Contact an admin if you need to invite someone.
            </Text>
          </CardContent>
        </Card>
        {membersLoading ? (
          <Text as="p" className="mt-6 text-sm text-muted-foreground">Loading members…</Text>
        ) : (
          <MemberList members={members ?? []} />
        )}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <Text as="h1" className="mb-1">Members</Text>
        <Text as="p" className="text-sm text-muted-foreground">
          Invite teammates to collaborate on mentions, replies, and leads.
        </Text>
      </div>

      {/* Invite form */}
      <Card>
        <CardHeader>
          <CardTitle>Invite a teammate</CardTitle>
          <CardDescription>
            They'll receive an email with a join link (valid for 7 days). You can also copy the link manually.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (inviteEmail.trim()) inviteMutation.mutate();
            }}
            className="space-y-3"
          >
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="teammate@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                className="flex-1"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as UserRole)}
                className="border-2 border-border bg-background px-3 text-sm font-[family-name:var(--font-sans)]"
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
              <Button type="submit" disabled={inviteMutation.isPending || !inviteEmail.trim()}>
                <UserPlus className="h-4 w-4 mr-1.5" />
                {inviteMutation.isPending ? "Sending..." : "Invite"}
              </Button>
            </div>
            {inviteMutation.isError && (
              <Text as="p" className="text-xs text-destructive">
                {inviteMutation.error?.message || "Failed to send invitation"}
              </Text>
            )}
            {inviteMutation.data?.invite_url && (
              <div className="flex items-center gap-2 p-2 border-2 border-border bg-muted">
                <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                <Text as="span" className="text-xs flex-1 truncate font-mono">
                  {inviteMutation.data.invite_url}
                </Text>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => copyLink(inviteMutation.data!.invite_url)}
                >
                  {copiedUrl === inviteMutation.data.invite_url ? (
                    <><Check className="h-3.5 w-3.5 mr-1" /> Copied</>
                  ) : (
                    <><Copy className="h-3.5 w-3.5 mr-1" /> Copy</>
                  )}
                </Button>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Pending invitations */}
      {invitesLoading ? (
        <Text as="p" className="text-sm text-muted-foreground">Loading invitations…</Text>
      ) : (
        invites && invites.length > 0 && (
          <div>
            <Text as="h2" className="mb-3">Pending invitations</Text>
            <div className="space-y-2">
              {invites.filter((i) => !i.accepted).map((inv) => (
                <PendingInviteRow
                  key={inv.id}
                  inv={inv}
                  onRevoke={() => revokeMutation.mutate(inv.id)}
                  onCopy={() => copyLink(inv.invite_url ?? "")}
                  copied={copiedUrl === inv.invite_url}
                  revoking={revokeMutation.isPending}
                />
              ))}
            </div>
          </div>
        )
      )}

      {/* Members list */}
      <div>
        <Text as="h2" className="mb-3">Members</Text>
        {membersLoading ? (
          <Text as="p" className="text-sm text-muted-foreground">Loading members…</Text>
        ) : (
          <MemberList members={members ?? []} currentUserId={user?.user_id} />
        )}
      </div>
    </div>
  );
}

function MemberList({ members, currentUserId }: { members: MemberRow[]; currentUserId?: string }) {
  return (
    <div className="space-y-2">
      {members.map((m) => {
        const meta = roleMeta[m.role];
        const Icon = meta.icon;
        return (
          <div key={m.id} className="flex items-center gap-3 p-3 border-2 border-border bg-card">
            <div className="w-9 h-9 bg-muted border-2 border-border rounded flex items-center justify-center text-sm font-semibold shrink-0">
              {m.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Text as="span" className="text-sm font-medium truncate">{m.name}</Text>
                {currentUserId === m.id && (
                  <Badge variant="outline" size="sm">You</Badge>
                )}
              </div>
              <Text as="span" className="text-xs text-muted-foreground truncate block">{m.email}</Text>
            </div>
            <Badge className={meta.color} size="sm">
              <Icon className="h-3 w-3 mr-1" />
              {meta.label}
            </Badge>
          </div>
        );
      })}
      {members.length === 0 && (
        <Text as="p" className="text-sm text-muted-foreground">No members yet.</Text>
      )}
    </div>
  );
}

function PendingInviteRow({
  inv,
  onRevoke,
  onCopy,
  copied,
  revoking,
}: {
  inv: InviteRow;
  onRevoke: () => void;
  onCopy: () => void;
  copied: boolean;
  revoking: boolean;
}) {
  const meta = roleMeta[inv.role];
  return (
    <div className="flex items-center gap-3 p-3 border-2 border-border bg-muted">
      <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <Text as="span" className="text-sm truncate block">{inv.email}</Text>
        <Text as="span" className="text-xs text-muted-foreground block">
          Expires {new Date(inv.expires_at).toLocaleDateString()}
        </Text>
      </div>
      <Badge className={meta.color} size="sm">{meta.label}</Badge>
      <Button size="sm" variant="outline" onClick={onCopy}>
        {copied ? <><Check className="h-3.5 w-3.5" /></> : <><Copy className="h-3.5 w-3.5" /></>}
      </Button>
      <Button size="sm" variant="outline" onClick={onRevoke} disabled={revoking}>
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}
