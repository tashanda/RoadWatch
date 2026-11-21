import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        roadwatch: {
          ink: "#10241f",
          forest: "#1d5947",
          lime: "#c5e86c",
          paper: "#f5f6ef",
        },
      },
    },
  },
  plugins: [],
};

export default config;
