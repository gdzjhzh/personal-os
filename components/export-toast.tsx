"use client";

import { useState } from "react";

type ExportToastProps = {
  filePath: string;
};

export function ExportToast({ filePath }: ExportToastProps) {
  const [visible, setVisible] = useState(Boolean(filePath));

  if (!visible) {
    return null;
  }

  function closeToast() {
    setVisible(false);

    const url = new URL(window.location.href);
    url.searchParams.delete("exported");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 grid max-w-[calc(100vw-2rem)] gap-2 border border-emerald-800 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 shadow-lg shadow-black/40 sm:w-[32rem]"
      role="status"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="font-semibold text-emerald-300">Markdown 导出成功</div>
          <div className="break-all font-mono text-xs leading-5 text-zinc-400">
            {filePath}
          </div>
        </div>
        <button
          aria-label="关闭导出提示"
          className="grid h-7 w-7 place-items-center border border-zinc-800 text-lg leading-none text-zinc-400 hover:border-emerald-600 hover:text-emerald-300"
          onClick={closeToast}
          type="button"
        >
          ×
        </button>
      </div>
    </div>
  );
}
