"use client";

import { useMemo, useRef, useState } from "react";

type PacketItem = {
  id: string;
  label: string;
  packet: string;
};

type CodexPacketPanelProps = {
  packets: PacketItem[];
};

export function CodexPacketPanel({ packets }: CodexPacketPanelProps) {
  const [selectedId, setSelectedId] = useState(packets[0]?.id || "");
  const [copyState, setCopyState] = useState("待复制");
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const selected = useMemo(
    () => packets.find((packet) => packet.id === selectedId) || packets[0],
    [packets, selectedId],
  );

  async function copyPacket() {
    if (!selected) {
      return;
    }

    try {
      await navigator.clipboard.writeText(selected.packet);
      setCopyState("已复制");
    } catch {
      textAreaRef.current?.select();
      document.execCommand("copy");
      setCopyState("已复制");
    }
  }

  if (packets.length === 0) {
    return <p className="text-base text-zinc-500">暂无任务可生成 Packet。</p>;
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="grid gap-1 text-sm text-zinc-400 sm:min-w-80">
          选择任务
          <select
            className="border border-zinc-800 bg-black px-2 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500"
            value={selected?.id || ""}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setCopyState("待复制");
            }}
          >
            {packets.map((packet) => (
              <option key={packet.id} value={packet.id}>
                {packet.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={copyPacket}
            className="border border-emerald-600 bg-emerald-500 px-3 py-2 text-base font-semibold text-black hover:bg-emerald-400"
          >
            复制给 Codex
          </button>
          <span className="pb-2 text-sm text-zinc-500">{copyState}</span>
        </div>
      </div>
      <textarea
        ref={textAreaRef}
        className="min-h-80 w-full resize-y border border-zinc-800 bg-black p-3 font-mono text-sm leading-6 text-zinc-200 outline-none focus:border-emerald-500"
        readOnly
        value={selected?.packet || ""}
      />
    </div>
  );
}
