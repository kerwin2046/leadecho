import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import {
  listAgents,
  createAgent,
  pauseAgent,
  resumeAgent,
  deleteAgent,
} from "@/lib/api";
import type { Agent, AgentStatus } from "@/lib/types";
import {
  Plus,
  Pause,
  Play,
  Trash2,
  Target,
  Search,
  MessageSquare,
  TrendingUp,
  Clock,
} from "lucide-react";

export const Route = createFileRoute("/_dashboard/agents/")({
  component: AgentsPage,
});

const statusMeta: Record<AgentStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-primary text-primary-foreground" },
  paused: { label: "Paused", className: "bg-muted text-muted-foreground" },
  error: { label: "Error", className: "bg-destructive text-destructive-foreground" },
};

function AgentsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPainPoints, setNewPainPoints] = useState("");
  const [newKeywords, setNewKeywords] = useState("");
  const [createError, setCreateError] = useState("");

  const { data: agents, isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: listAgents,
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const pain_points = newPainPoints
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const keywordTerms = newKeywords
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      return createAgent({
        name: newName,
        description: newDesc,
        pain_points,
        keywords: keywordTerms.map((term) => ({
          term,
          platforms: ["hackernews", "reddit"],
        })),
      });
    },
    onSuccess: (agent) => {
      setShowCreate(false);
      setNewName("");
      setNewDesc("");
      setNewPainPoints("");
      setNewKeywords("");
      setCreateError("");
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      navigate({ to: "/agents/$agentId", params: { agentId: agent.id } });
    },
    onError: (err: any) => setCreateError(err.message || "Failed to create agent"),
  });

  const pauseMutation = useMutation({
    mutationFn: (id: string) => pauseAgent(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
  });

  const resumeMutation = useMutation({
    mutationFn: (id: string) => resumeAgent(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAgent(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
  });

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Text as="h1" className="mb-1">Agents</Text>
          <Text as="p" className="text-sm text-muted-foreground">
            Monitoring agents scanning platforms for buying signals. {agents && `(${agents.length} total)`}
          </Text>
        </div>
        {isAdmin && (
          <Button onClick={() => setShowCreate((s) => !s)}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Agent
          </Button>
        )}
      </div>

      {/* Inline create form */}
      {showCreate && isAdmin && (
        <Card className="mb-6">
          <CardContent className="p-6 space-y-4">
            <Text as="h3" className="mb-2">Create a new agent</Text>
            <div className="grid gap-3">
              <Input
                placeholder="Agent name (e.g. 'SaaS buyers')"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Input
                placeholder="Description (what problem this agent watches for)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
              <div>
                <Text as="span" className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  Pain points (one per line)
                </Text>
                <textarea
                  className="w-full border-2 border-border bg-background p-3 text-sm font-mono min-h-[80px]"
                  placeholder={"looking for CNC software\ncomparing manufacturing platforms"}
                  value={newPainPoints}
                  onChange={(e) => setNewPainPoints(e.target.value)}
                />
              </div>
              <div>
                <Text as="span" className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  Keywords (one per line, default platforms: HN + Reddit)
                </Text>
                <textarea
                  className="w-full border-2 border-border bg-background p-3 text-sm font-mono min-h-[60px]"
                  placeholder={"CNC software\nmanufacturing platform"}
                  value={newKeywords}
                  onChange={(e) => setNewKeywords(e.target.value)}
                />
              </div>
              {createError && (
                <Text as="p" className="text-xs text-destructive">{createError}</Text>
              )}
              <div className="flex gap-2">
                <Button
                  onClick={() => createMutation.mutate()}
                  disabled={!newName.trim() || createMutation.isPending}
                >
                  {createMutation.isPending ? "Creating..." : "Create Agent"}
                </Button>
                <Button variant="outline" onClick={() => setShowCreate(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {isLoading && <Text as="p" className="text-sm text-muted-foreground">Loading agents…</Text>}

      {/* Empty state */}
      {!isLoading && agents && agents.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <Target className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <Text as="h3" className="mb-2">No agents yet</Text>
            <Text as="p" className="text-sm text-muted-foreground mb-4">
              {isAdmin
                ? "Create your first agent to start monitoring platforms for buying signals."
                : "Ask a workspace admin to create an agent."}
            </Text>
            {isAdmin && (
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                Create Agent
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Agent cards grid */}
      {agents && agents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isAdmin={isAdmin}
              onPause={() => pauseMutation.mutate(agent.id)}
              onResume={() => resumeMutation.mutate(agent.id)}
              onDelete={() => {
                if (confirm(`Delete agent "${agent.name}"? This removes all its keywords and pain points.`)) {
                  deleteMutation.mutate(agent.id);
                }
              }}
              pausing={pauseMutation.isPending}
              resuming={resumeMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCard({
  agent,
  isAdmin,
  onPause,
  onResume,
  onDelete,
  pausing,
  resuming,
}: {
  agent: Agent;
  isAdmin: boolean;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
  pausing: boolean;
  resuming: boolean;
}) {
  const navigate = useNavigate();
  const meta = statusMeta[agent.status] ?? statusMeta.active;
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <Link to="/agents/$agentId" params={{ agentId: agent.id }} className="flex-1 min-w-0">
            <Text as="h3" className="truncate hover:underline cursor-pointer">{agent.name}</Text>
          </Link>
          <Badge className={meta.className} size="sm">{meta.label}</Badge>
        </div>

        {agent.description && (
          <Text as="p" className="text-xs text-muted-foreground mb-4 line-clamp-2">
            {agent.description}
          </Text>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <Stat icon={Search} label="Keywords" value={agent.keyword_count} />
          <Stat icon={Target} label="Pain Points" value={agent.pain_point_count} />
          <Stat icon={MessageSquare} label="Mentions" value={agent.total_mentions} />
        </div>

        {/* Last run */}
        {agent.last_run_at && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4">
            <Clock className="h-3 w-3" />
            <span>Last run {new Date(agent.last_run_at).toLocaleString()}</span>
            {agent.last_run_mentions != null && (
              <span>· +{agent.last_run_mentions} mentions</span>
            )}
          </div>
        )}

        {/* Admin controls */}
        {isAdmin && (
          <div className="flex gap-2 pt-3 border-t-2 border-border">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => navigate({ to: "/agents/$agentId", params: { agentId: agent.id } })}>
              <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
              Details
            </Button>
            {agent.status === "active" ? (
              <Button variant="outline" size="sm" onClick={onPause} disabled={pausing}>
                <Pause className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={onResume} disabled={resuming}>
                <Play className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Search; label: string; value: number }) {
  return (
    <div className="border-2 border-border bg-muted p-2">
      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
        <Icon className="h-3 w-3" />
        <span>{label}</span>
      </div>
      <Text as="span" className="text-lg font-semibold font-[family-name:var(--font-head)]">
        {value}
      </Text>
    </div>
  );
}
