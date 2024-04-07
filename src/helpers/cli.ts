import { Command, Interfaces, Flags, Help } from "@oclif/core";

export const helpFlag = (opts: Partial<Interfaces.BooleanFlag<boolean>> = {}) => {
  return Flags.boolean({
    description: "Show CLI help.",
    ...opts,
    parse: async (_, cmd) => {
      const { loadHelpClass } = await import("@oclif/core/lib/help");
const HelpClass = await loadHelpClass(cmd.config);
await new HelpClass(cmd.config).showHelp(cmd.id ? [cmd.id] : []);
      return cmd.exit(0) as never;
    }
  });
};
