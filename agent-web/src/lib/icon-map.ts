import {
  MessageSquare,
  Image,
  Video,
  Music,
  Wand2,
  ShoppingBag,
  FileText,
  Scissors,
  Sparkles,
  Eraser,
  Expand,
  Maximize,
  Combine,
  PenTool,
  CreditCard,
  UserCircle,
  LayoutGrid,
  type LucideIcon,
} from "lucide-react";

export const iconMap: Record<string, LucideIcon> = {
  MessageSquare,
  Image,
  Video,
  Music,
  Wand2,
  ShoppingBag,
  FileText,
  Scissors,
  Sparkles,
  Eraser,
  Expand,
  Maximize,
  Combine,
  PenTool,
  CreditCard,
  UserCircle,
  LayoutGrid,
};

export function getIcon(name: string): LucideIcon {
  return iconMap[name] || Image;
}
