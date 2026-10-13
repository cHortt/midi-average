import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MeanPitch } from "./mean-pitch";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MeanPitch />
  </StrictMode>,
);
