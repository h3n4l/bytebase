import { defineStore } from "pinia";
import { ref } from "vue";
import { useRouter } from "vue-router";

interface Filter {
  // project mainly using to filter databases in SQL Editor.
  // If specified, only databases in the project will be shown.
  // Format: "projects/{project}"
  project?: string;
  // database mainly using to specify the selected database.
  // Using in SQL Editor and other database related pages.
  // Format: "instances/{instance}/databases/{database}"
  database?: string;
  // the schema name.
  schema?: string;
  // the table name.
  table?: string;
}

export const useFilterStore = defineStore("filter", () => {
  const router = useRouter();
  const filter = ref<Filter>({});

  // Initial filter with route query immediately.
  // And it should not be updated when route changed later except the page is reloaded.
  const { query } = router.currentRoute.value;
  if (query.filter && typeof query.filter === "string") {
    try {
      filter.value = JSON.parse(query.filter);
    } catch (error) {
      console.error("Failed to parse filter", query.filter);
    }
  } else {
    if (typeof query.schema === "string" && query.schema) {
      filter.value.schema = query.schema;
    }
    if (typeof query.table === "string" && query.table) {
      filter.value.table = query.table;
    }
  }

  return {
    filter,
  };
});
