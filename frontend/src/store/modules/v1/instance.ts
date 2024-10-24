import { defineStore } from "pinia";
import { computed, reactive, unref, watchEffect } from "vue";
import { instanceServiceClient } from "@/grpcweb";
import type { ComposedInstance, MaybeRef } from "@/types";
import { unknownEnvironment, unknownInstance } from "@/types";
import { State } from "@/types/proto/v1/common";
import type { DataSource, Instance } from "@/types/proto/v1/instance_service";
import { extractInstanceResourceName } from "@/utils";
import { getResourceStoreCacheKey, type StoreCache } from "./cache";
import { useEnvironmentV1Store } from "./environment";

export const useInstanceV1Store = defineStore("instance_v1", () => {
  const listCache = reactive(new Map<string, StoreCache>());
  const instanceMapByName = reactive(new Map<string, ComposedInstance>());

  const reset = () => {
    instanceMapByName.clear();
  };

  // Getters
  const instanceList = computed(() => {
    const list = Array.from(instanceMapByName.values());
    return list;
  });
  const activeInstanceList = computed(() => {
    return instanceList.value.filter((instance) => {
      return instance.state === State.ACTIVE;
    });
  });
  const activateInstanceCount = computed(() => {
    let count = 0;
    for (const instance of activeInstanceList.value) {
      if (instance.activation) {
        count++;
      }
    }
    return count;
  });

  // Actions
  const upsertInstances = async (list: Instance[]) => {
    const composedInstances = await Promise.all(
      list.map((instance) => composeInstance(instance))
    );
    composedInstances.forEach((composed) => {
      instanceMapByName.set(composed.name, composed);
    });
    return composedInstances;
  };
  const listInstances = async (showDeleted = false) => {
    const cacheKey = getResourceStoreCacheKey(
      "instance",
      showDeleted ? "" : "active"
    );
    if (!listCache.has(cacheKey)) {
      listCache.set(cacheKey, {
        timestamp: Date.now(),
        isFetching: true,
      });
    }
    const { instances } = await instanceServiceClient.listInstances({
      showDeleted,
    });
    const composed = await upsertInstances(instances);
    listCache.set(cacheKey, {
      timestamp: Date.now(),
      isFetching: false,
    });
    return composed;
  };
  const createInstance = async (instance: Instance) => {
    const createdInstance = await instanceServiceClient.createInstance({
      instance,
      instanceId: extractInstanceResourceName(instance.name),
    });
    const composed = await upsertInstances([createdInstance]);

    return composed[0];
  };
  const updateInstance = async (instance: Instance, updateMask: string[]) => {
    const updatedInstance = await instanceServiceClient.updateInstance({
      instance,
      updateMask,
    });
    const composed = await upsertInstances([updatedInstance]);
    return composed[0];
  };
  const archiveInstance = async (instance: Instance, force = false) => {
    await instanceServiceClient.deleteInstance({
      name: instance.name,
      force,
    });
    instance.state = State.DELETED;
    const composed = await upsertInstances([instance]);
    return composed[0];
  };
  const restoreInstance = async (instance: Instance) => {
    await instanceServiceClient.undeleteInstance({
      name: instance.name,
    });
    instance.state = State.ACTIVE;
    const composed = await upsertInstances([instance]);
    return composed[0];
  };
  const syncInstance = async (instance: Instance) => {
    await instanceServiceClient.syncInstance({
      name: instance.name,
    });
  };
  const batchSyncInstances = async (instanceNameList: string[]) => {
    await instanceServiceClient.batchSyncInstances({
      requests: instanceNameList.map((name) => ({ name })),
    });
  };
  const fetchInstanceByName = async (name: string, silent = false) => {
    const instance = await instanceServiceClient.getInstance(
      {
        name,
      },
      {
        silent,
      }
    );
    const composed = await upsertInstances([instance]);
    return composed[0];
  };
  const getInstanceByName = (name: string) => {
    return instanceMapByName.get(name) ?? unknownInstance();
  };
  const getOrFetchInstanceByName = async (name: string, silent = false) => {
    const cached = instanceMapByName.get(name);
    if (cached) {
      return cached;
    }
    await fetchInstanceByName(name, silent);
    return getInstanceByName(name);
  };
  const createDataSource = async (
    instance: Instance,
    dataSource: DataSource
  ) => {
    const updatedInstance = await instanceServiceClient.addDataSource({
      name: instance.name,
      dataSource: dataSource,
    });
    const [composed] = await upsertInstances([updatedInstance]);
    return composed;
  };
  const updateDataSource = async (
    instance: Instance,
    dataSource: DataSource,
    updateMask: string[]
  ) => {
    const updatedInstance = await instanceServiceClient.updateDataSource({
      name: instance.name,
      dataSource: dataSource,
      updateMask,
    });
    const [composed] = await upsertInstances([updatedInstance]);
    return composed;
  };
  const deleteDataSource = async (
    instance: Instance,
    dataSource: DataSource
  ) => {
    const updatedInstance = await instanceServiceClient.removeDataSource({
      name: instance.name,
      dataSource: dataSource,
    });
    const [composed] = await upsertInstances([updatedInstance]);
    return composed;
  };

  return {
    reset,
    listCache,
    instanceList,
    activeInstanceList,
    activateInstanceCount,
    createInstance,
    updateInstance,
    archiveInstance,
    restoreInstance,
    syncInstance,
    batchSyncInstances,
    listInstances,
    getInstanceByName,
    getOrFetchInstanceByName,
    createDataSource,
    updateDataSource,
    deleteDataSource,
  };
});

export const useInstanceV1List = (showDeleted: MaybeRef<boolean> = false) => {
  const store = useInstanceV1Store();
  const cacheKey = getResourceStoreCacheKey(
    "instance",
    showDeleted ? "" : "active"
  );
  const cache = computed(() => store.listCache.get(cacheKey));

  watchEffect(() => {
    // If request is already in progress, do not send another request.
    if (cache.value?.isFetching) {
      return;
    }
    // If cache is available and forceUpdate is false, do not send another request.
    if (cache.value) {
      return;
    }
    store.listInstances(unref(showDeleted));
  });

  const instanceList = computed(() => {
    if (unref(showDeleted)) {
      return store.instanceList;
    }
    return store.activeInstanceList;
  });
  return {
    instanceList,
    ready: computed(() => cache.value && !cache.value.isFetching),
  };
};

const composeInstance = async (instance: Instance) => {
  const composed = instance as ComposedInstance;
  const environmentEntity =
    (await useEnvironmentV1Store().getOrFetchEnvironmentByName(
      instance.environment
    )) ?? unknownEnvironment();
  composed.environmentEntity = environmentEntity;
  return composed;
};
