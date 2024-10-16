import { computed } from "vue";
import { useProjectV1Store, useCurrentUserV1 } from "@/store";
import { isValidProjectName } from "@/types";
import { hasProjectPermissionV2, useDynamicLocalStorage } from "@/utils";

const MAX_RECENT_PROJECT = 5;

export const useRecentProjects = () => {
  const projectV1Store = useProjectV1Store();
  const currentUser = useCurrentUserV1();

  const recentViewProjectNames = useDynamicLocalStorage<string[]>(
    computed(() => `bb.project.recent-view.${currentUser.value.name}`),
    []
  );

  const setRecentProject = (name: string) => {
    if (!name) {
      return;
    }
    const index = recentViewProjectNames.value.findIndex(
      (proj) => proj === name
    );
    if (index >= 0) {
      recentViewProjectNames.value.splice(index, 1);
    }

    recentViewProjectNames.value.unshift(name);
    if (recentViewProjectNames.value.length > MAX_RECENT_PROJECT) {
      recentViewProjectNames.value.pop();
    }
  };

  const recentViewProjects = computed(() => {
    return recentViewProjectNames.value
      .map((project) => {
        return projectV1Store.getProjectByName(project);
      })
      .filter(
        (project) =>
          isValidProjectName(project.name) &&
          hasProjectPermissionV2(project, currentUser.value, "bb.projects.get")
      );
  });

  return {
    setRecentProject,
    recentViewProjects,
  };
};
