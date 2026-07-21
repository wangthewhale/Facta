import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// An 8 MB image expands to roughly 10.7 MB when Base64-encoded. Parse only
// the OCR endpoint with the larger limit so the route can enforce the real
// image-size rule while every other JSON endpoint keeps Express's small
// default limit.
app.use("/api/submissions/ocr", express.json({ limit: "11mb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const payloadErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  const payloadError = err as { type?: string };
  if (payloadError?.type === "entity.too.large") {
    const isOcrRequest = req.originalUrl.startsWith("/api/submissions/ocr");
    res.status(413).json({
      error: isOcrRequest
        ? "Image is larger than the 8 MB limit"
        : "Request body is too large",
    });
    return;
  }
  next(err);
};

app.use(payloadErrorHandler);

export default app;
