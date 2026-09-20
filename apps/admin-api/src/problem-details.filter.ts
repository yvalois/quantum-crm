import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";

interface HttpResponse {
  readonly status: (status: number) => HttpResponse;
  readonly type: (contentType: string) => HttpResponse;
  readonly send: (body: unknown) => void;
}

const titles: Readonly<Record<number, string>> = Object.freeze({
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  412: "Precondition Failed",
  428: "Precondition Required",
  503: "Service Unavailable",
});

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    host
      .switchToHttp()
      .getResponse<HttpResponse>()
      .status(status)
      .type("application/problem+json")
      .send({
        type: "about:blank",
        title: titles[status] ?? "Internal Server Error",
        status,
      });
  }
}
