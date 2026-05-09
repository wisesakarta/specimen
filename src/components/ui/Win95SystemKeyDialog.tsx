"use client";

import React, { useState } from "react";
import Win95Window from "./Win95Window";

interface Win95SystemKeyDialogProps {
  onAuthorize: (key: string) => void;
  onCancel: () => void;
}

const Win95SystemKeyDialog: React.FC<Win95SystemKeyDialogProps> = ({ onAuthorize, onCancel }) => {
  const [key, setKey] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (key.trim()) {
      onAuthorize(key.trim());
    }
  };

  return (
    <div style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.4)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999
    }}>
      <Win95Window
        title="System Authorization"
        width={350}
        onClose={onCancel}
        isActive={true}
      >
        <form onSubmit={handleSubmit} style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <img 
              src="/win95-icons/Mmsys100_32x32_4.png" 
              alt="Security" 
              style={{ width: "32px", height: "32px" }}
            />
            <p style={{ margin: 0, fontSize: "12px" }}>
              Please enter the <b>Sovereign System Key</b> to access the Specimen Runtime.
            </p>
          </div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={{ fontSize: "11px" }}>System Key:</label>
            <input 
              type="password"
              autoFocus
              value={key}
              onChange={(e) => setKey(e.target.value)}
              style={{
                backgroundColor: "white",
                border: "none",
                boxShadow: "inset -1px -1px #fff, inset 1px 1px #0a0a0a, inset -2px -2px #dfdfdf, inset 2px 2px #808080",
                padding: "4px 6px",
                outline: "none",
                fontSize: "12px",
                fontFamily: "var(--font-departure)"
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
            <button 
              type="submit"
              className="win95-button"
              style={{ width: "80px" }}
            >
              OK
            </button>
            <button 
              type="button"
              className="win95-button"
              onClick={onCancel}
              style={{ width: "80px" }}
            >
              Cancel
            </button>
          </div>
        </form>
      </Win95Window>
    </div>
  );
};

export default Win95SystemKeyDialog;
