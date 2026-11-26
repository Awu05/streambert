export const SETTINGS_TABS = [
  { id: "general", sections: ["updates", "notifications", "discordRpc"] },
  { id: "playback", sections: ["playback", "subtitles"] },
  { id: "sources", sections: ["sources"] },
  { id: "appearance", sections: ["interface"] },
  { id: "library", sections: ["content", "library"] },
  { id: "downloads", sections: ["downloads"] },
  { id: "data", sections: ["backup", "storage"] },
];

export function tabForSection(section) {
  return SETTINGS_TABS.find(({ sections }) => sections.includes(section))?.id ?? null;
}
