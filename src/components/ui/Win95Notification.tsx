"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/style-composer";
import Win95Window from "./Win95Window";

export type NoticeType = "info" | "success" | "error" | "analyzing";

interface Win95NotificationProps {
  type: NoticeType;
  message: string;
}

const TYPE_TITLE: Record<NoticeType, string> = {
  info:      "Specimen",
  success:   "Specimen",
  error:     "Specimen — Error",
  analyzing: "Specimen — Working",
};

/* ─── Authentic Win95 user32.dll dialog icons ─── */

function IconInfo() {
  return (
    <div
      aria-hidden
      style={{
        width: 32, height: 32, borderRadius: "50%",
        background: "#000080",
        border: "2px solid #000000",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
        boxShadow: "inset 1px 1px 0 #4040c0, inset -1px -1px 0 #000040",
      }}
    >
      <span style={{ color: "#ffffff", fontSize: 18, fontWeight: "bold", fontFamily: "serif", lineHeight: 1, userSelect: "none" }}>i</span>
    </div>
  );
}

function IconError() {
  return (
    <div
      aria-hidden
      style={{
        width: 32, height: 32, borderRadius: "50%",
        background: "#c00000",
        border: "2px solid #000000",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
        boxShadow: "inset 1px 1px 0 #e04040, inset -1px -1px 0 #600000",
      }}
    >
      <span style={{ color: "#ffffff", fontSize: 16, fontWeight: "bold", fontFamily: "var(--font-shell)", lineHeight: 1, userSelect: "none" }}>✕</span>
    </div>
  );
}

function IconSuccess() {
  return (
    <div
      aria-hidden
      style={{
        width: 32, height: 32, borderRadius: "50%",
        background: "#007000",
        border: "2px solid #000000",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
        boxShadow: "inset 1px 1px 0 #40a040, inset -1px -1px 0 #003000",
      }}
    >
      <span style={{ color: "#ffffff", fontSize: 16, fontWeight: "bold", fontFamily: "var(--font-shell)", lineHeight: 1, userSelect: "none" }}>✓</span>
    </div>
  );
}

function IconHourglass() {
  return (
    <div aria-hidden style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <svg viewBox="0 0 16 16" width={24} height={24} style={{ imageRendering: "pixelated" }}>
        {/* Outer frame */}
        <rect x="2"  y="0"  width="12" height="2"  fill="#000000"/>
        <rect x="2"  y="14" width="12" height="2"  fill="#000000"/>
        <rect x="2"  y="0"  width="2"  height="2"  fill="#000000"/>
        <rect x="12" y="0"  width="2"  height="2"  fill="#000000"/>
        {/* Upper sand */}
        <rect x="2"  y="2"  width="12" height="1"  fill="#404040"/>
        <rect x="3"  y="3"  width="10" height="1"  fill="#808000"/>
        <rect x="4"  y="4"  width="8"  height="1"  fill="#808000"/>
        <rect x="5"  y="5"  width="6"  height="1"  fill="#808000"/>
        <rect x="6"  y="6"  width="4"  height="1"  fill="#808000"/>
        <rect x="7"  y="7"  width="2"  height="1"  fill="#808000"/>
        {/* Neck */}
        <rect x="7"  y="7"  width="2"  height="2"  fill="#404040"/>
        {/* Lower sand */}
        <rect x="7"  y="9"  width="2"  height="1"  fill="#808000"/>
        <rect x="6"  y="10" width="4"  height="1"  fill="#808000"/>
        <rect x="5"  y="11" width="6"  height="1"  fill="#808000"/>
        <rect x="4"  y="12" width="8"  height="1"  fill="#808000"/>
        <rect x="3"  y="13" width="10" height="1"  fill="#404040"/>
      </svg>
    </div>
  );
}

const TYPE_ICON: Record<NoticeType, React.ReactNode> = {
  info:      <IconInfo />,
  success:   <IconSuccess />,
  error:     <IconError />,
  analyzing: <IconHourglass />,
};

export default function Win95Notification({ type, message }: Win95NotificationProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.05, ease: "linear" } }}
      exit={{ opacity: 0, transition: { duration: 0.05, ease: "linear" } }}
      style={{ pointerEvents: "none" }}
    >
      <Win95Window
        title={TYPE_TITLE[type]}
        active
        style={{ minWidth: 280, maxWidth: "80vw", pointerEvents: "none" }}
        variants={{ hidden: {}, visible: {}, exit: {} }}
        initial="visible"
        animate="visible"
        exit="visible"
      >
        <div className="flex flex-col gap-3 p-4" style={{ background: "var(--win-face)" }}>

          {/* Content row */}
          <div className="flex items-start gap-3">
            {TYPE_ICON[type]}
            <p
              className="select-none"
              style={{ fontSize: "var(--win-font-size)", lineHeight: "1.4", maxWidth: 220, paddingTop: 4 }}
            >
              {message}
            </p>
          </div>

          {/* Analyzing progress bar — solid Win95 blocks */}
          {type === "analyzing" && (
            <div
              style={{
                height: 18,
                background: "var(--win-face)",
                boxShadow: "var(--bevel-sunken)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <motion.div
                style={{
                  position: "absolute",
                  top: 2, bottom: 2, left: 2,
                  display: "flex", gap: 2,
                }}
                animate={{ x: ["0px", "14px"] }}
                transition={{ duration: 0.6, repeat: Infinity, ease: "linear" }}
              >
                {[...Array(16)].map((_, i) => (
                  <div key={i} style={{ width: 10, height: "100%", background: "var(--win-title-active)", flexShrink: 0 }} />
                ))}
              </motion.div>
            </div>
          )}
        </div>
      </Win95Window>
    </motion.div>
  );
}
