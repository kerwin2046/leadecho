import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import {
  getAgent,
  getAgentStats,
  updateAgent,
  pauseAgent,
  resumeAgent,
  deleteAgent,
  listAgentKeywords,
  createAgentKeyword,
  deleteKeyword,
} from "@/lib/api";
import type { AgentStatus } from "@/lib/types";
import {
  ArrowLeft,
  Pause,
  Play,
  Trash2,
  Plus,
  X,
  Search,
  Target,
  MessageSquare,
  TrendingUp,
  Clock,
} from "lucide-react";

export const Route = createFileRoute("/_dashboard/agents/$agentId")({
  component: AgentDetailPage,
});

const statusMeta: Record<AgentStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-primary text-primary-foreground" },
  paused: { label: "Paused", className: "bg-muted text-muted-foreground" },
  error: { label: "Error", className: "bg-destructive text-destructive-foreground" },
};

function AgentDetailPage() {
  const { agentId } = Route.useParams();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();

  const { data: agent, isLoading } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => getAgent(agentId),
  });

  const { data: stats7d } = useQuery({
    queryKey: ["agent-stats", agentId, 7],
    queryFn: () => getAgentStats(agentId, 7),
  });

  const { data: keywords } = useQuery({
    queryKey: ["agent-keywords", agentId],
    queryFn: () => listAgentKeywords(agentId),
  });

  const pauseMutation = useMutation({
    mutationFn: () => pauseAgent(agentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agent", agentId] }),
  });

  const resumeMutation = useMutation({
    mutationFn: () => resumeAgent(agentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agent", agentId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      window.location.href = "/app/agents";
    },
  });

  if (isLoading) {
    return <Text as="p" className="text-sm text-muted-foreground">Loading agent…</Text>;
  }

  if (!agent) {
    return (
      <div>
        <Text as="p" className="text-sm text-muted-foreground mb-4">Agent not found.</Text>
        <Link to="/agents"><Button variant="outline">← Back to agents</Button></Link>
      </div>
    );
  }

  const meta = statusMeta[agent.status] ?? statusMeta.active;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <Link to="/agents" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />
        All agents
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <Text as="h1">{agent.name}</Text>
            <Badge className={meta.className} size="sm">{meta.label}</Badge>
          </div>
          {agent.description && (
            <Text as="p" className="text-sm text-muted-foreground">{agent.description}</Text>
          )}
        </div>
        {isAdmin && (
          <div className="flex gap-2 shrink-0">
            {agent.status === "active" ? (
              <Button variant="outline" size="sm" onClick={() => pauseMutation.mutate()} disabled={pauseMutation.isPending}>
                <Pause className="h-3.5 w-3.5 mr-1.5" /> Pause
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending}>
                <Play className="h-3.5 w-3.5 mr-1.5" /> Resume
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (confirm(`Delete agent "${agent.name}"? This removes all its keywords and pain points.`)) {
                  deleteMutation.mutate();
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        <StatCard icon={Search} label="Keywords" value={agent.keyword_count} />
        <StatCard icon={Target} label="Pain Points" value={agent.pain_point_count} />
        <StatCard icon={MessageSquare} label="Mentions (7d)" value={stats7d?.mentions ?? 0} />
        <StatCard icon={TrendingUp} label="Replies (7d)" value={stats7d?.replies ?? 0} />
        <StatCard icon={Clock} label="Total" value={agent.total_mentions} />
      </div>

      {/* Pain Points */}
      <PainPointsSection agentId={agentId} painPoints={agent.pain_points} isAdmin={isAdmin} />

      {/* Keywords */}
      <KeywordsSection
        agentId={agentId}
        keywords={keywords ?? []}
        isAdmin={isAdmin}
      />

      {/* Last run info */}
      {agent.last_run_at && (
        <Card className="mt-6">
          <CardContent className="p-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span>Last scan: {new Date(agent.last_run_at).toLocaleString()}</span>
            {agent.last_run_mentions != null && (
              <span>· found {agent.last_run_mentions} new mentions</span>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Search; label: string; value: number }) {
  return (
    <div className="border-2 border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <Text as="span" className="text-2xl font-semibold font-[family-name:var(--font-head)]">
        {value}
      </Text>
    </div>
  );
}

function PainPointsSection({ agentId, painPoints, isAdmin }: { agentId: string; painPoints: string[]; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(painPoints.join("\n"));
  const [newPp, setNewPp] = useState("");

  const updateMutation = useMutation({
    mutationFn: (pps: string[]) => updateAgent(agentId, { pain_points: pps }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      setEditing(false);
    },
  });

  const startEdit = () => {
    setDraft(painPoints.join("\n"));
    setEditing(true);
  };

  const saveEdit = () => {
    const pps = draft.split("\n").map((s) => s.trim()).filter(Boolean);
    updateMutation.mutate(pps);
  };

  const addQuick = () => {
    if (!newPp.trim()) return;
    updateMutation.mutate([...painPoints, newPp.trim()]);
    setNewPp("");
  };

  const removeOne = (pp: string) => {
    updateMutation.mutate(painPoints.filter((p) => p !== pp));
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Pain points</CardTitle>
            <CardDescription>Phrases this agent matches semantically via embeddings</CardDescription>
          </div>
          {isAdmin && !editing && (
            <Button variant="outline" size="sm" onClick={startEdit}>Edit</Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="space-y-3">
            <textarea
              className="w-full border-2 border-border bg-background p-3 text-sm font-mono min-h-[100px]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="One pain point per line"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveEdit} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {painPoints.length === 0 ? (
              <Text as="p" className="text-sm text-muted-foreground">No pain points configured.</Text>
            ) : (
              <div className="flex flex-wrap gap-2">
                {painPoints.map((pp) => (
                  <span
                    key={pp}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-muted border-2 border-border text-xs"
                  >
                    {pp}
                    {isAdmin && (
                      <button onClick={() => removeOne(pp)} className="text-muted-foreground hover:text-destructive cursor-pointer">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
            {isAdmin && (
              <div className="flex gap-2 pt-2">
                <Input
                  placeholder="Add a pain point…"
                  value={newPp}
                  onChange={(e) => setNewPp(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addQuick(); }}
                  className="flex-1"
                />
                <Button size="sm" onClick={addQuick} disabled={!newPp.trim() || updateMutation.isPending}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KeywordsSection({ agentId, keywords, isAdmin }: { agentId: string; keywords: import("@/lib/types").Keyword[]; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [newTerm, setNewTerm] = useState("");

  const addMutation = useMutation({
    mutationFn: (term: string) => createAgentKeyword(agentId, { term, platforms: ["hackernews", "reddit"] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-keywords", agentId] });
      queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      setNewTerm("");
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => deleteKeyword(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-keywords", agentId] });
      queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Keywords</CardTitle>
        <CardDescription>Search terms this agent monitors across platforms</CardDescription>
      </CardHeader>
      <CardContent>
        {keywords.length === 0 ? (
          <Text as="p" className="text-sm text-muted-foreground mb-3">No keywords yet.</Text>
        ) : (
          <div className="space-y-2 mb-3">
            {keywords.map((kw) => (
              <div key={kw.id} className="flex items-center gap-3 p-2 border-2 border-border bg-muted">
                <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <Text as="span" className="text-sm font-medium">{kw.term}</Text>
                  <div className="flex gap-1 mt-0.5">
                    {kw.platforms.map((p) => (
                      <Badge key={p} variant="outline" size="sm">{p}</Badge>
                    ))}
                  </div>
                </div>
                {isAdmin && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => removeMutation.mutate(kw.id)}
                  >
                    <X className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        {isAdmin && (
          <div className="flex gap-2">
            <Input
              placeholder="Add keyword…"
              value={newTerm}
              onChange={(e) => setNewTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newTerm.trim()) addMutation.mutate(newTerm.trim()); }}
              className="flex-1"
            />
            <Button
              size="sm"
              onClick={() => newTerm.trim() && addMutation.mutate(newTerm.trim())}
              disabled={!newTerm.trim() || addMutation.isPending}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
