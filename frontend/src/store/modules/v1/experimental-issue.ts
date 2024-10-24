import { ref, watch, type WatchCallback } from "vue";
import {
  issueServiceClient,
  planServiceClient,
  rolloutServiceClient,
} from "@/grpcweb";
import { useCurrentUserV1, useProjectV1Store, useUserStore } from "@/store";
import type { ComposedIssue, ComposedProject } from "@/types";
import {
  emptyIssue,
  emptyRollout,
  unknownUser,
  EMPTY_ID,
  EMPTY_ISSUE_NAME,
  unknownIssue,
  UNKNOWN_ID,
  UNKNOWN_ISSUE_NAME,
} from "@/types";
import type { Issue } from "@/types/proto/v1/issue_service";
import type { Plan } from "@/types/proto/v1/plan_service";
import type { Rollout } from "@/types/proto/v1/rollout_service";
import {
  extractProjectResourceName,
  extractUserResourceName,
  hasProjectPermissionV2,
} from "@/utils";

export interface ComposeIssueConfig {
  withPlan?: boolean;
  withRollout?: boolean;
}

export const composeIssue = async (
  rawIssue: Issue,
  config: ComposeIssueConfig = { withPlan: true, withRollout: true }
): Promise<ComposedIssue> => {
  const userStore = useUserStore();
  const me = useCurrentUserV1();

  const project = `projects/${extractProjectResourceName(rawIssue.name)}`;
  const projectEntity =
    await useProjectV1Store().getOrFetchProjectByName(project);

  const creatorEntity =
    userStore.getUserByEmail(extractUserResourceName(rawIssue.creator)) ??
    unknownUser();

  const issue: ComposedIssue = {
    ...rawIssue,
    planEntity: undefined,
    planCheckRunList: [],
    rolloutEntity: emptyRollout(),
    rolloutTaskRunList: [],
    project,
    projectEntity,
    creatorEntity,
  };

  if (config.withPlan && issue.plan) {
    if (issue.plan) {
      if (hasProjectPermissionV2(projectEntity, me.value, "bb.plans.get")) {
        const plan = await planServiceClient.getPlan({
          name: issue.plan,
        });
        issue.planEntity = plan;
      }
      if (
        hasProjectPermissionV2(projectEntity, me.value, "bb.planCheckRuns.list")
      ) {
        // Only show the latest plan check runs.
        // TODO(steven): maybe we need to show all plan check runs on a separate page later.
        const { planCheckRuns } = await planServiceClient.listPlanCheckRuns({
          parent: issue.plan,
          latestOnly: true,
        });
        issue.planCheckRunList = planCheckRuns;
      }
    }
  }
  if (config.withRollout && issue.rollout) {
    if (hasProjectPermissionV2(projectEntity, me.value, "bb.rollouts.get")) {
      issue.rolloutEntity = await rolloutServiceClient.getRollout({
        name: issue.rollout,
      });
    }

    if (hasProjectPermissionV2(projectEntity, me.value, "bb.taskRuns.list")) {
      const { taskRuns } = await rolloutServiceClient.listTaskRuns({
        parent: `${issue.rollout}/stages/-/tasks/-`,
        pageSize: 1000, // MAX
      });
      issue.rolloutTaskRunList = taskRuns;
    }
  }

  return issue;
};

export const shallowComposeIssue = async (
  rawIssue: Issue,
  config?: ComposeIssueConfig
): Promise<ComposedIssue> => {
  return composeIssue(
    rawIssue,
    config || { withPlan: false, withRollout: false }
  );
};

export const experimentalFetchIssueByUID = async (
  uid: string,
  project = "-"
) => {
  if (uid === "undefined") {
    console.warn("undefined issue uid");
    return unknownIssue();
  }

  if (uid === String(EMPTY_ID)) return emptyIssue();
  if (uid === String(UNKNOWN_ID)) return unknownIssue();

  const rawIssue = await issueServiceClient.getIssue({
    name: `projects/${project}/issues/${uid}`,
  });

  return composeIssue(rawIssue);
};

export const experimentalFetchIssueByName = async (name: string) => {
  if (name === EMPTY_ISSUE_NAME) return emptyIssue();
  if (name === UNKNOWN_ISSUE_NAME) return unknownIssue();

  const rawIssue = await issueServiceClient.getIssue({
    name,
  });

  return composeIssue(rawIssue);
};

export type CreateIssueHooks = {
  planCreated: (plan: Plan) => Promise<any>;
  issueCreated: (issue: Issue, plan: Plan) => Promise<any>;
  rolloutCreated: (issue: Issue, plan: Plan, rollout: Rollout) => Promise<any>;
};
export const experimentalCreateIssueByPlan = async (
  project: ComposedProject,
  issueCreate: Issue,
  planCreate: Plan,
  hooks?: Partial<CreateIssueHooks>
) => {
  const createdPlan = await planServiceClient.createPlan({
    parent: project.name,
    plan: planCreate,
  });
  issueCreate.plan = createdPlan.name;
  await hooks?.planCreated?.(planCreate);

  const createdIssue = await issueServiceClient.createIssue({
    parent: project.name,
    issue: issueCreate,
  });
  await hooks?.issueCreated?.(createdIssue, createdPlan);
  const createdRollout = await rolloutServiceClient.createRollout({
    parent: project.name,
    rollout: {
      plan: createdPlan.name,
    },
  });
  createdIssue.rollout = createdRollout.name;
  await hooks?.rolloutCreated?.(createdIssue, createdPlan, createdRollout);

  return { createdPlan, createdIssue, createdRollout };
};

const REFRESH_PLAN_LIST = ref(Math.random());
export const refreshPlanList = () => {
  REFRESH_PLAN_LIST.value = Math.random();
};
export const useRefreshPlanList = (callback: WatchCallback) => {
  watch(REFRESH_PLAN_LIST, callback);
};
