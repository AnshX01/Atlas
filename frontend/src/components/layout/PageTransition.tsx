"use client";

import { motion } from "framer-motion";
import { usePathname } from "next/navigation";

const pageVariants = {
  initial: {
    opacity: 0,
    y: 8,
  },
  animate: {
    opacity: 1,
    y: 0,
  },
};

const pageTransition = {
  type: "spring",
  stiffness: 400,
  damping: 30,
  mass: 0.8,
  duration: 0.2,
};

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <motion.div
      key={pathname}
      className="h-full"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      transition={pageTransition}
    >
      {children}
    </motion.div>
  );
}
