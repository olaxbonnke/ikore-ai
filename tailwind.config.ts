import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/app/**/*.{js,ts,jsx,tsx,mdx}", "./src/components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        oko: {
          green: "#1F5130",
          maize: "#E8B923",
          soil: "#6B4F2A",
          cream: "#FAF7F0",
          risk: {
            green: "#2E7D32",
            amber: "#F9A825",
            red: "#C62828",
          },
        },
      },
    },
  },
  plugins: [],
};

export default config;
