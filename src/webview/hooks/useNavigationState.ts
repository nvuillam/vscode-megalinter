import { useState, useEffect } from "react";
import type {
  MainTabId,
  MenuItem,
  MenuChild,
  NavigationTarget,
} from "../types";

export const useNavigationState = (initialState?: {
  activeMainTab?: MainTabId;
  selectedCategory?: string | null;
  selectedDescriptor?: string | null;
  selectedScope?: string | null;
}) => {
  const [activeMainTab, setActiveMainTab] = useState<MainTabId>(
    initialState?.activeMainTab || "home",
  );
  const [selectedCategory, setSelectedCategory] = useState<string | null>(
    initialState?.selectedCategory || null,
  );
  const [selectedDescriptor, setSelectedDescriptor] = useState<string | null>(
    initialState?.selectedDescriptor || null,
  );
  const [selectedScope, setSelectedScope] = useState<string | null>(
    initialState?.selectedScope || null,
  );

  const handleNavigationSelect = (item: MenuItem | MenuChild) => {
    if (item.type === "home") {
      setActiveMainTab("home");
      setSelectedCategory(null);
      setSelectedDescriptor(null);
      setSelectedScope(null);
      return;
    }

    if (item.type === "summary") {
      setActiveMainTab("summary");
      setSelectedCategory(null);
      setSelectedDescriptor(null);
      setSelectedScope(null);
      return;
    }

    if (item.type === "general") {
      setActiveMainTab("general");
      setSelectedCategory(null);
      setSelectedDescriptor(null);
      setSelectedScope(null);
      return;
    }

    if (item.type === "category") {
      setActiveMainTab("category");
      setSelectedCategory(item.id);
      setSelectedDescriptor(null);
      setSelectedScope(null);
      return;
    }

    if (item.type === "linter") {
      setActiveMainTab("descriptors");
      setSelectedCategory(null);
      setSelectedDescriptor((item as MenuChild).parentId);
      setSelectedScope(item.id);
      return;
    }

    setActiveMainTab("descriptors");
    setSelectedCategory(null);
    setSelectedDescriptor(item.id);
    setSelectedScope("descriptor");
  };

  const applyNavigation = (target: NavigationTarget) => {
    if (!target) {
      return;
    }

    if (target.type === "home") {
      setActiveMainTab("home");
      setSelectedCategory(null);
      setSelectedDescriptor(null);
      setSelectedScope(null);
      return;
    }

    if (target.type === "general") {
      setActiveMainTab("general");
      setSelectedCategory(null);
      return;
    }

    if (target.type === "summary") {
      setActiveMainTab("summary");
      setSelectedCategory(null);
      setSelectedDescriptor(null);
      setSelectedScope(null);
      return;
    }

    if (target.type === "category") {
      setActiveMainTab("category");
      setSelectedCategory(target.categoryId);
      setSelectedDescriptor(null);
      setSelectedScope(null);
      return;
    }

    if (target.type === "descriptor") {
      setActiveMainTab("descriptors");
      setSelectedCategory(null);
      setSelectedDescriptor(target.descriptorId);
      setSelectedScope("descriptor");
      return;
    }

    if (target.type === "linter") {
      setActiveMainTab("descriptors");
      setSelectedCategory(null);
      setSelectedDescriptor(target.descriptorId);
      setSelectedScope(target.linterId);
    }
  };

  const openSummary = () => {
    setActiveMainTab("summary");
    setSelectedCategory(null);
    setSelectedDescriptor(null);
    setSelectedScope(null);
  };

  const openGeneral = () => {
    setActiveMainTab("general");
    setSelectedCategory(null);
    setSelectedDescriptor(null);
    setSelectedScope(null);
  };

  const openCategory = (categoryId: string | null) => {
    if (!categoryId) {
      return;
    }
    setActiveMainTab("category");
    setSelectedCategory(categoryId);
    setSelectedDescriptor(null);
    setSelectedScope(null);
  };

  const openDescriptor = (
    descriptorId: string | null,
    scopeId?: string | null,
  ) => {
    if (!descriptorId) {
      return;
    }
    setActiveMainTab("descriptors");
    setSelectedCategory(null);
    setSelectedDescriptor(descriptorId);
    setSelectedScope(scopeId || "descriptor");
  };

  return {
    activeMainTab,
    setActiveMainTab,
    selectedCategory,
    setSelectedCategory,
    selectedDescriptor,
    setSelectedDescriptor,
    selectedScope,
    setSelectedScope,
    handleNavigationSelect,
    applyNavigation,
    openSummary,
    openGeneral,
    openCategory,
    openDescriptor,
  };
};
