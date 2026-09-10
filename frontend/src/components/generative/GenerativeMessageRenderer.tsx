"use client";

import React from "react";
import { ValidationContractCard, type ValidationContractData } from "./ValidationContractCard";
import { PullRequestCard, type PullRequestData } from "./PullRequestCard";
import { LangfuseSessionCard, type LangfuseSessionData } from "./LangfuseSessionCard";
import { DeploymentStatusCard, type DeploymentCardData } from "./DeploymentStatusCard";
import { Bot, Sparkles, Terminal, ShieldCheck, GitPullRequest, Rocket } from "lucide-react";

export interface GenerativeMessageRendererProps {
  content: string;
  senderName?: string;
  senderRole?: string;
  metadata?: Record<string, unknown>;
  interactive?: boolean;
}

export function GenerativeMessageRenderer({
  content,
  senderName,
  senderRole,
  metadata,
  interactive = true,
}: GenerativeMessageRendererProps) {
  // Check if metadata holds structured generative cards
  const validationContract = metadata?.validation_contract as ValidationContractData | undefined;
  const pullRequest = metadata?.pull_request as PullRequestData | undefined;
  const langfuseSession = metadata?.langfuse_session as LangfuseSessionData | undefined;
  const deployment = metadata?.deployment as DeploymentCardData | undefined;

  // In-line parser for JSON codeblocks that might be generative cards
  let parsedCard: {
    type: "validation" | "pr" | "langfuse" | "deployment";
    data: unknown;
  } | null = null;

  if (content.includes("```json:teamflow-") || content.includes("```json:generative-")) {
    try {
      if (content.includes("json:teamflow-validation")) {
        const jsonMatch = content.match(/```json:teamflow-validation\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          parsedCard = { type: "validation", data: JSON.parse(jsonMatch[1]) };
        }
      } else if (content.includes("json:teamflow-pr")) {
        const jsonMatch = content.match(/```json:teamflow-pr\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          parsedCard = { type: "pr", data: JSON.parse(jsonMatch[1]) };
        }
      } else if (content.includes("json:teamflow-deployment")) {
        const jsonMatch = content.match(/```json:teamflow-deployment\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          parsedCard = { type: "deployment", data: JSON.parse(jsonMatch[1]) };
        }
      }
    } catch (e) {
      console.warn("Could not parse in-line generative component:", e);
    }
  }

  return (
    <div className="space-y-3">
      {/* Primary Text Content */}
      <div className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">
        {content.replace(/```json:teamflow-[\s\S]*?```/g, "").trim()}
      </div>

      {/* Hydrated Generative Cards */}
      {(validationContract || (parsedCard && parsedCard.type === "validation")) && (
        <div className="mt-2">
          <ValidationContractCard
            contract={
              validationContract || (parsedCard?.data as ValidationContractData)
            }
            interactive={interactive}
          />
        </div>
      )}

      {(pullRequest || (parsedCard && parsedCard.type === "pr")) && (
        <div className="mt-2">
          <PullRequestCard
            data={pullRequest || (parsedCard?.data as PullRequestData)}
          />
        </div>
      )}

      {(deployment || (parsedCard && parsedCard.type === "deployment")) && (
        <div className="mt-2">
          <DeploymentStatusCard
            data={deployment || (parsedCard?.data as DeploymentCardData)}
          />
        </div>
      )}

      {langfuseSession && (
        <div className="mt-2">
          <LangfuseSessionCard data={langfuseSession} />
        </div>
      )}
    </div>
  );
}
