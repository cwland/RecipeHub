// App icons from Lucide (lucide.dev, open source, ISC license). Each wrapper keeps the app's own
// name and default size, so screens just use <RecipesIcon /> etc.
import {
  BadgeCheck,
  CirclePlus,
  Wrench,
  RefreshCcwDot,
  ArrowLeft,
  Compass,
  RefreshCw,
  Rss,
  Inbox as LucideInbox,
  BookOpen,
  ChefHat,
  Clock,
  Copy,
  Ellipsis,
  Undo2,
  Tag,
  WandSparkles,
  ExternalLink,
  FolderPlus,
  Pencil,
  Pin,
  SlidersHorizontal,
  Share2,
  Info,
  Mail,
  Users,
  CalendarDays,
  Check as LucideCheck,
  ChevronDown as LucideChevronDown,
  ChevronLeft as LucideChevronLeft,
  ChevronRight as LucideChevronRight,
  ChevronUp as LucideChevronUp,
  Eye,
  EyeOff,
  GripVertical,
  Refrigerator,
  ShoppingCart,
  LogOut,
  Plus,
  Minus,
  LayoutGrid,
  List as LucideList,
  RotateCcw,
  Search,
  Settings,
  Star,
  Trash2,
  User,
  X,
  type LucideIcon,
} from "lucide-react";

type P = { className?: string };
const icon = (I: LucideIcon, size: string, strokeWidth = 2) =>
  function AppIcon({ className = size }: P) {
    return <I className={className} strokeWidth={strokeWidth} aria-hidden />;
  };

export const ChevronLeft = icon(LucideChevronLeft, "size-4");
export const ChevronRight = icon(LucideChevronRight, "size-4");
export const ChevronDown = icon(LucideChevronDown, "size-4");
export const ChevronUp = icon(LucideChevronUp, "size-4");
export const Trash = icon(Trash2, "size-4", 1.8);
export const Check = icon(LucideCheck, "size-4", 2.4);
export const RecipesIcon = icon(BookOpen, "size-5", 1.8);
export const PlannerIcon = icon(CalendarDays, "size-5", 1.8);
export const GroceryIcon = icon(ShoppingCart, "size-5", 1.8);
export const PantryIcon = icon(Refrigerator, "size-5", 1.8);
export const LogoutIcon = icon(LogOut, "size-5", 1.8);
export const PlusIcon = icon(Plus, "size-5");
export const MinusIcon = icon(Minus, "size-4");
export const GridViewIcon = icon(LayoutGrid, "size-4", 1.8);
export const ListViewIcon = icon(LucideList, "size-4", 1.8);
export const GearIcon = icon(Settings, "size-5", 1.8);
export const GripIcon = icon(GripVertical, "size-4");
export const UserIcon = icon(User, "size-5", 1.8);
export const ResetIcon = icon(RotateCcw, "size-5", 1.8);
export const EyeIcon = icon(Eye, "size-5", 1.8);
export const EyeOffIcon = icon(EyeOff, "size-5", 1.8);
export const CloseIcon = icon(X, "size-6", 1.8);
export const SearchIcon = icon(Search, "size-4");
export const BackIcon = icon(ArrowLeft, "size-5", 1.8);
export const ChefIcon = icon(ChefHat, "size-8", 1.5);
export const ClockIcon = icon(Clock, "size-4", 1.8);
export const CopyIcon = icon(Copy, "size-4", 1.8);
export const MoreIcon = icon(Ellipsis, "size-4", 2);
export const WandIcon = icon(WandSparkles, "size-4", 1.8);
export const UndoIcon = icon(Undo2, "size-4", 1.8);
export const TagIcon = icon(Tag, "size-4", 1.8);
export const LinkOutIcon = icon(ExternalLink, "size-4", 1.8);
export const CollectionAddIcon = icon(FolderPlus, "size-4", 1.8);
export const EditIcon = icon(Pencil, "size-4", 1.8);
export const ServingsIcon = icon(Users, "size-4", 1.8);
export const FilterIcon = icon(SlidersHorizontal, "size-4", 1.8);
export const ShareIcon = icon(Share2, "size-4", 1.8);
export const InboxIcon = icon(LucideInbox, "size-5", 1.8);
export const DiscoverIcon = icon(Compass, "size-5", 1.8);
export const RefreshIcon = icon(RefreshCw, "size-4", 1.8);
export const FeedIcon = icon(Rss, "size-4", 1.8);
export const InfoIcon = icon(Info, "size-4", 2);
export const MailIcon = icon(Mail, "size-4", 1.8);

// Filled when on (pinned)
export function PinIcon({ filled, className = "size-5" }: P & { filled?: boolean }) {
  return <Pin className={className} strokeWidth={1.8} fill={filled ? "currentColor" : "none"} aria-hidden />;
}

// Filled when on (favorites)
export function StarIcon({ filled, className = "size-6" }: P & { filled?: boolean }) {
  return <Star className={className} strokeWidth={1.8} fill={filled ? "currentColor" : "none"} aria-hidden />;
}

// RecipeHub mark: a rounded square in the theme's brand color with a white leaf
export const Logo = ({ className = "size-8" }: P) => (
  <svg viewBox="0 0 32 32" className={className} role="img" aria-label="RecipeHub">
    <rect width="32" height="32" rx="8" fill="var(--color-brand)" />
    <path d="M9 23c0-8 5.5-13.5 14-14 .4 8.6-5 14-13 14z" fill="#fff" />
    <path d="M10 22.5 18 14" stroke="var(--color-brand)" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
export const WhatsNewIcon = icon(BadgeCheck, "size-8", 1.6);
export const AddedIcon = icon(CirclePlus, "size-4", 2);
export const ChangedIcon = icon(RefreshCcwDot, "size-4", 2);
export const FixedIcon = icon(Wrench, "size-4", 2);
