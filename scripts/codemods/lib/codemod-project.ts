import { Project } from "ts-morph";

export function createProject(): Project {
  return new Project({
    skipAddingFilesFromTsConfig: true,
    manipulationSettings: {
      useTrailingCommas: false,
    },
  });
}
