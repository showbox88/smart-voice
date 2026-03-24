import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";

interface ChatHeaderProps {
  title: string;
  onTitleChange: (title: string) => void;
}

export default function ChatHeader({ title, onTitleChange }: ChatHeaderProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = useCallback(() => {
    setEditValue(title);
    setIsEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  }, [title]);

  const commitEdit = useCallback(() => {
    setIsEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== title) {
      onTitleChange(trimmed);
    }
  }, [editValue, title, onTitleChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitEdit();
      }
      if (e.key === "Escape") {
        setIsEditing(false);
        setEditValue(title);
      }
    },
    [commitEdit, title]
  );

  return (
    <div className="flex items-center h-10 px-3 border-b border-border/20 shrink-0">
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            className={cn(
              "input-inline w-full text-xs font-medium text-foreground",
              "outline-none appearance-none",
              "rounded-sm focus-visible:ring-1 focus-visible:ring-primary/30 px-1 -mx-1"
            )}
          />
        ) : (
          <p
            onDoubleClick={startEditing}
            className="text-xs font-medium text-foreground truncate cursor-default"
            title={t("chat.editTitle")}
          >
            {title}
          </p>
        )}
      </div>
    </div>
  );
}
