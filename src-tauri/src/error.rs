use serde::{Deserialize, Serialize};
use std::fmt;

/// Machine-readable error codes matching the ADP TypeScript schema (ADPErrorCode).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ADPErrorCode {
    #[serde(rename = "WORKTREE_NOT_FOUND")]
    WorktreeNotFound,
    #[serde(rename = "WORKTREE_STEP_INVALID")]
    WorktreeStepInvalid,
    #[serde(rename = "QA_CHECK_TIMEOUT")]
    QaCheckTimeout,
    #[serde(rename = "TERMINAL_SPAWN_FAILED")]
    TerminalSpawnFailed,
    #[serde(rename = "TERMINAL_NOT_FOUND")]
    TerminalNotFound,
    #[serde(rename = "SESSION_NOT_FOUND")]
    SessionNotFound,
    #[serde(rename = "SERVICE_AUTH_FAILED")]
    ServiceAuthFailed,
    #[serde(rename = "SERVICE_REQUEST_FAILED")]
    ServiceRequestFailed,
    #[serde(rename = "SERVICE_RATE_LIMITED")]
    ServiceRateLimited,
    #[serde(rename = "SERVICE_TIMEOUT")]
    ServiceTimeout,
    #[serde(rename = "FILE_IO_ERROR")]
    FileIoError,
    #[serde(rename = "COMMAND_EXECUTION_FAILED")]
    CommandExecutionFailed,
    #[serde(rename = "PARSE_ERROR")]
    ParseError,
    #[serde(rename = "SCHEMA_VALIDATION_FAILED")]
    SchemaValidationFailed,
    #[serde(rename = "UNKNOWN_EVENT_TYPE")]
    UnknownEventType,
    #[serde(rename = "INTERNAL_ERROR")]
    InternalError,
}

impl fmt::Display for ADPErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = serde_json::to_value(self)
            .ok()
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_else(|| format!("{:?}", self));
        write!(f, "{}", s)
    }
}

/// Structured error type for the Agentic Dashboard Protocol.
/// Mirrors the `ADPError` interface from `schema.ts`.
///
/// Tauri v2 serializes the error type as JSON when a command returns `Err`.
/// `rename_all = "camelCase"` ensures field names match the TypeScript interface
/// (e.g. `retryAfterMs` instead of `retry_after_ms`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ADPError {
    /// Machine-readable error code
    pub code: ADPErrorCode,

    /// Human-readable error description
    pub message: String,

    /// Stack trace or additional details (dev only)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,

    /// Whether the error is recoverable via retry
    pub retryable: bool,

    /// Recommended wait time before retry in milliseconds
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
}

impl ADPError {
    /// Create a new non-retryable error.
    pub fn new(code: ADPErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
            retryable: false,
            retry_after_ms: None,
        }
    }

    /// Create a retryable error with a recommended wait time.
    pub fn retryable(code: ADPErrorCode, message: impl Into<String>, retry_after_ms: u64) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
            retryable: true,
            retry_after_ms: Some(retry_after_ms),
        }
    }

    /// Attach additional details to this error.
    pub fn with_details(mut self, details: impl Into<String>) -> Self {
        self.details = Some(details.into());
        self
    }

    /// Shorthand for a non-retryable internal error.
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ADPErrorCode::InternalError, message)
    }

    /// Shorthand for a file I/O error.
    pub fn file_io(message: impl Into<String>) -> Self {
        Self::new(ADPErrorCode::FileIoError, message)
    }

    /// Shorthand for a validation error.
    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(ADPErrorCode::SchemaValidationFailed, message)
    }

    /// Shorthand for a command execution failure.
    pub fn command_failed(message: impl Into<String>) -> Self {
        Self::new(ADPErrorCode::CommandExecutionFailed, message)
    }

    /// Shorthand for a parse error.
    pub fn parse(message: impl Into<String>) -> Self {
        Self::new(ADPErrorCode::ParseError, message)
    }
}

impl From<std::io::Error> for ADPError {
    fn from(err: std::io::Error) -> Self {
        Self::file_io(err.to_string())
    }
}

impl From<serde_json::Error> for ADPError {
    fn from(err: serde_json::Error) -> Self {
        Self::parse(err.to_string())
    }
}

impl fmt::Display for ADPError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)?;
        if let Some(ref details) = self.details {
            write!(f, " — {}", details)?;
        }
        Ok(())
    }
}

impl std::error::Error for ADPError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_code_serializes_to_screaming_snake() {
        let code = ADPErrorCode::SessionNotFound;
        let json = serde_json::to_string(&code).unwrap();
        assert_eq!(json, "\"SESSION_NOT_FOUND\"");
    }

    #[test]
    fn new_error_codes_serialize_correctly() {
        assert_eq!(
            serde_json::to_string(&ADPErrorCode::SessionNotFound).unwrap(),
            "\"SESSION_NOT_FOUND\""
        );
        assert_eq!(
            serde_json::to_string(&ADPErrorCode::FileIoError).unwrap(),
            "\"FILE_IO_ERROR\""
        );
        assert_eq!(
            serde_json::to_string(&ADPErrorCode::CommandExecutionFailed).unwrap(),
            "\"COMMAND_EXECUTION_FAILED\""
        );
    }

    #[test]
    fn error_display_includes_code_and_message() {
        let err = ADPError::new(ADPErrorCode::InternalError, "something broke");
        let display = format!("{}", err);
        assert!(display.contains("INTERNAL_ERROR"));
        assert!(display.contains("something broke"));
    }

    #[test]
    fn retryable_error_has_retry_fields() {
        let err = ADPError::retryable(ADPErrorCode::ServiceRateLimited, "slow down", 5000);
        assert!(err.retryable);
        assert_eq!(err.retry_after_ms, Some(5000));
    }

    #[test]
    fn error_serializes_with_camel_case_fields() {
        let err = ADPError::retryable(ADPErrorCode::ServiceRateLimited, "slow down", 5000);
        let json = serde_json::to_string(&err).unwrap();
        // Must use camelCase field names to match TypeScript ADPError interface
        assert!(
            json.contains("\"retryAfterMs\""),
            "expected camelCase retryAfterMs, got: {json}"
        );
        assert!(json.contains("\"retryable\""));
        assert!(
            !json.contains("\"retry_after_ms\""),
            "must not use snake_case"
        );
    }

    #[test]
    fn convenience_constructors() {
        let err = ADPError::internal("boom");
        assert_eq!(err.code, ADPErrorCode::InternalError);

        let err = ADPError::file_io("disk full");
        assert_eq!(err.code, ADPErrorCode::FileIoError);

        let err = ADPError::validation("bad input");
        assert_eq!(err.code, ADPErrorCode::SchemaValidationFailed);

        let err = ADPError::command_failed("git died");
        assert_eq!(err.code, ADPErrorCode::CommandExecutionFailed);

        let err = ADPError::parse("invalid json");
        assert_eq!(err.code, ADPErrorCode::ParseError);
    }

    #[test]
    fn from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let adp_err: ADPError = io_err.into();
        assert_eq!(adp_err.code, ADPErrorCode::FileIoError);
        assert!(adp_err.message.contains("file missing"));
    }

    #[test]
    fn from_serde_json_error() {
        let json_err = serde_json::from_str::<serde_json::Value>("not json").unwrap_err();
        let adp_err: ADPError = json_err.into();
        assert_eq!(adp_err.code, ADPErrorCode::ParseError);
    }

    // --- Exhaustive ADPErrorCode serialization (every variant, SCREAMING_SNAKE) ---

    #[test]
    fn every_error_code_serializes_to_screaming_snake() {
        let cases = [
            (ADPErrorCode::WorktreeNotFound, "\"WORKTREE_NOT_FOUND\""),
            (
                ADPErrorCode::WorktreeStepInvalid,
                "\"WORKTREE_STEP_INVALID\"",
            ),
            (ADPErrorCode::QaCheckTimeout, "\"QA_CHECK_TIMEOUT\""),
            (
                ADPErrorCode::TerminalSpawnFailed,
                "\"TERMINAL_SPAWN_FAILED\"",
            ),
            (ADPErrorCode::TerminalNotFound, "\"TERMINAL_NOT_FOUND\""),
            (ADPErrorCode::SessionNotFound, "\"SESSION_NOT_FOUND\""),
            (ADPErrorCode::ServiceAuthFailed, "\"SERVICE_AUTH_FAILED\""),
            (
                ADPErrorCode::ServiceRequestFailed,
                "\"SERVICE_REQUEST_FAILED\"",
            ),
            (ADPErrorCode::ServiceRateLimited, "\"SERVICE_RATE_LIMITED\""),
            (ADPErrorCode::ServiceTimeout, "\"SERVICE_TIMEOUT\""),
            (ADPErrorCode::FileIoError, "\"FILE_IO_ERROR\""),
            (
                ADPErrorCode::CommandExecutionFailed,
                "\"COMMAND_EXECUTION_FAILED\"",
            ),
            (ADPErrorCode::ParseError, "\"PARSE_ERROR\""),
            (
                ADPErrorCode::SchemaValidationFailed,
                "\"SCHEMA_VALIDATION_FAILED\"",
            ),
            (ADPErrorCode::UnknownEventType, "\"UNKNOWN_EVENT_TYPE\""),
            (ADPErrorCode::InternalError, "\"INTERNAL_ERROR\""),
        ];
        for (code, expected) in cases {
            assert_eq!(serde_json::to_string(&code).unwrap(), expected);
        }
    }

    #[test]
    fn every_error_code_deserializes_from_screaming_snake() {
        let cases = [
            ("\"WORKTREE_NOT_FOUND\"", ADPErrorCode::WorktreeNotFound),
            (
                "\"WORKTREE_STEP_INVALID\"",
                ADPErrorCode::WorktreeStepInvalid,
            ),
            ("\"QA_CHECK_TIMEOUT\"", ADPErrorCode::QaCheckTimeout),
            (
                "\"TERMINAL_SPAWN_FAILED\"",
                ADPErrorCode::TerminalSpawnFailed,
            ),
            ("\"TERMINAL_NOT_FOUND\"", ADPErrorCode::TerminalNotFound),
            ("\"SESSION_NOT_FOUND\"", ADPErrorCode::SessionNotFound),
            ("\"SERVICE_AUTH_FAILED\"", ADPErrorCode::ServiceAuthFailed),
            (
                "\"SERVICE_REQUEST_FAILED\"",
                ADPErrorCode::ServiceRequestFailed,
            ),
            ("\"SERVICE_RATE_LIMITED\"", ADPErrorCode::ServiceRateLimited),
            ("\"SERVICE_TIMEOUT\"", ADPErrorCode::ServiceTimeout),
            ("\"FILE_IO_ERROR\"", ADPErrorCode::FileIoError),
            (
                "\"COMMAND_EXECUTION_FAILED\"",
                ADPErrorCode::CommandExecutionFailed,
            ),
            ("\"PARSE_ERROR\"", ADPErrorCode::ParseError),
            (
                "\"SCHEMA_VALIDATION_FAILED\"",
                ADPErrorCode::SchemaValidationFailed,
            ),
            ("\"UNKNOWN_EVENT_TYPE\"", ADPErrorCode::UnknownEventType),
            ("\"INTERNAL_ERROR\"", ADPErrorCode::InternalError),
        ];
        for (json, expected) in cases {
            let parsed: ADPErrorCode = serde_json::from_str(json).unwrap();
            assert_eq!(parsed, expected);
        }
    }

    #[test]
    fn error_code_round_trips_through_json() {
        let all = [
            ADPErrorCode::WorktreeNotFound,
            ADPErrorCode::WorktreeStepInvalid,
            ADPErrorCode::QaCheckTimeout,
            ADPErrorCode::TerminalSpawnFailed,
            ADPErrorCode::TerminalNotFound,
            ADPErrorCode::SessionNotFound,
            ADPErrorCode::ServiceAuthFailed,
            ADPErrorCode::ServiceRequestFailed,
            ADPErrorCode::ServiceRateLimited,
            ADPErrorCode::ServiceTimeout,
            ADPErrorCode::FileIoError,
            ADPErrorCode::CommandExecutionFailed,
            ADPErrorCode::ParseError,
            ADPErrorCode::SchemaValidationFailed,
            ADPErrorCode::UnknownEventType,
            ADPErrorCode::InternalError,
        ];
        for code in all {
            let json = serde_json::to_string(&code).unwrap();
            let back: ADPErrorCode = serde_json::from_str(&json).unwrap();
            assert_eq!(code, back);
        }
    }

    #[test]
    fn error_code_deserialize_rejects_unknown_variant() {
        let result = serde_json::from_str::<ADPErrorCode>("\"NOT_A_REAL_CODE\"");
        assert!(result.is_err());
    }

    #[test]
    fn error_code_deserialize_rejects_snake_case() {
        // The wire format is SCREAMING_SNAKE; lowercase must fail.
        assert!(serde_json::from_str::<ADPErrorCode>("\"session_not_found\"").is_err());
    }

    // --- ADPErrorCode Display ---

    #[test]
    fn error_code_display_matches_serialized_string() {
        assert_eq!(
            format!("{}", ADPErrorCode::QaCheckTimeout),
            "QA_CHECK_TIMEOUT"
        );
        assert_eq!(
            format!("{}", ADPErrorCode::UnknownEventType),
            "UNKNOWN_EVENT_TYPE"
        );
        assert_eq!(
            format!("{}", ADPErrorCode::WorktreeStepInvalid),
            "WORKTREE_STEP_INVALID"
        );
    }

    #[test]
    fn error_code_equality_and_clone() {
        let a = ADPErrorCode::ServiceTimeout;
        let b = a.clone();
        assert_eq!(a, b);
        assert_ne!(
            ADPErrorCode::ServiceTimeout,
            ADPErrorCode::ServiceAuthFailed
        );
    }

    #[test]
    fn error_code_debug_format_is_variant_name() {
        assert_eq!(format!("{:?}", ADPErrorCode::FileIoError), "FileIoError");
    }

    // --- ADPError::new ---

    #[test]
    fn new_error_is_not_retryable_and_has_no_extras() {
        let err = ADPError::new(ADPErrorCode::TerminalNotFound, "gone");
        assert_eq!(err.code, ADPErrorCode::TerminalNotFound);
        assert_eq!(err.message, "gone");
        assert!(!err.retryable);
        assert_eq!(err.retry_after_ms, None);
        assert_eq!(err.details, None);
    }

    #[test]
    fn new_accepts_string_and_str_via_into() {
        let from_str = ADPError::new(ADPErrorCode::InternalError, "literal");
        let from_string = ADPError::new(ADPErrorCode::InternalError, String::from("owned"));
        assert_eq!(from_str.message, "literal");
        assert_eq!(from_string.message, "owned");
    }

    // --- ADPError::retryable ---

    #[test]
    fn retryable_constructor_sets_all_fields() {
        let err = ADPError::retryable(ADPErrorCode::ServiceTimeout, "took too long", 1500);
        assert_eq!(err.code, ADPErrorCode::ServiceTimeout);
        assert_eq!(err.message, "took too long");
        assert!(err.retryable);
        assert_eq!(err.retry_after_ms, Some(1500));
        assert_eq!(err.details, None);
    }

    #[test]
    fn retryable_accepts_zero_wait() {
        let err = ADPError::retryable(ADPErrorCode::ServiceRequestFailed, "retry now", 0);
        assert!(err.retryable);
        assert_eq!(err.retry_after_ms, Some(0));
    }

    // --- ADPError::with_details ---

    #[test]
    fn with_details_attaches_details() {
        let err = ADPError::internal("boom").with_details("at line 42");
        assert_eq!(err.details, Some("at line 42".to_string()));
    }

    #[test]
    fn with_details_preserves_other_fields() {
        let err = ADPError::retryable(ADPErrorCode::ServiceRateLimited, "slow", 200)
            .with_details("rate window 60s");
        assert!(err.retryable);
        assert_eq!(err.retry_after_ms, Some(200));
        assert_eq!(err.code, ADPErrorCode::ServiceRateLimited);
        assert_eq!(err.details, Some("rate window 60s".to_string()));
    }

    #[test]
    fn with_details_can_be_overwritten() {
        let err = ADPError::internal("x")
            .with_details("first")
            .with_details("second");
        assert_eq!(err.details, Some("second".to_string()));
    }

    // --- Convenience constructors: messages preserved, not retryable ---

    #[test]
    fn convenience_constructors_preserve_message_and_are_non_retryable() {
        for err in [
            ADPError::internal("m1"),
            ADPError::file_io("m2"),
            ADPError::validation("m3"),
            ADPError::command_failed("m4"),
            ADPError::parse("m5"),
        ] {
            assert!(!err.retryable);
            assert_eq!(err.retry_after_ms, None);
            assert!(!err.message.is_empty());
        }
    }

    // --- From conversions ---

    #[test]
    fn from_io_error_preserves_kind_message() {
        let io_err =
            std::io::Error::new(std::io::ErrorKind::PermissionDenied, "access denied here");
        let adp: ADPError = io_err.into();
        assert_eq!(adp.code, ADPErrorCode::FileIoError);
        assert!(adp.message.contains("access denied here"));
        assert!(!adp.retryable);
    }

    #[test]
    fn from_serde_json_error_carries_message() {
        let json_err = serde_json::from_str::<i32>("[1,2]").unwrap_err();
        let adp: ADPError = json_err.into();
        assert_eq!(adp.code, ADPErrorCode::ParseError);
        assert!(!adp.message.is_empty());
        assert!(!adp.retryable);
    }

    #[test]
    fn from_conversion_works_with_question_mark() {
        fn read_missing() -> Result<(), ADPError> {
            let _content = std::fs::read_to_string("/definitely/not/a/real/path/xyz")?;
            Ok(())
        }
        let err = read_missing().unwrap_err();
        assert_eq!(err.code, ADPErrorCode::FileIoError);
    }

    // --- Display ---

    #[test]
    fn error_display_without_details_has_no_dash() {
        let err = ADPError::new(ADPErrorCode::ParseError, "bad");
        assert_eq!(format!("{}", err), "[PARSE_ERROR] bad");
    }

    #[test]
    fn error_display_with_details_appends_dash_segment() {
        let err = ADPError::new(ADPErrorCode::ParseError, "bad").with_details("context");
        let display = format!("{}", err);
        assert!(display.starts_with("[PARSE_ERROR] bad"));
        assert!(display.contains("context"));
        assert!(display.contains('—'));
    }

    // --- std::error::Error impl ---

    #[test]
    fn adp_error_is_std_error() {
        let err = ADPError::internal("boxed");
        let boxed: Box<dyn std::error::Error> = Box::new(err);
        assert!(boxed.to_string().contains("INTERNAL_ERROR"));
    }

    // --- ADPError serde: skip_serializing_if and round-trip ---

    #[test]
    fn error_omits_none_details_and_retry_after_ms() {
        let err = ADPError::new(ADPErrorCode::SessionNotFound, "missing");
        let json = serde_json::to_string(&err).unwrap();
        assert!(!json.contains("details"));
        assert!(!json.contains("retryAfterMs"));
        assert!(json.contains("\"retryable\":false"));
    }

    #[test]
    fn error_serializes_details_field_in_camel_case() {
        let err = ADPError::file_io("disk").with_details("more info");
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("\"details\":\"more info\""));
    }

    #[test]
    fn error_round_trips_through_json_full() {
        let err = ADPError::retryable(ADPErrorCode::ServiceTimeout, "timeout", 750)
            .with_details("upstream slow");
        let json = serde_json::to_string(&err).unwrap();
        let back: ADPError = serde_json::from_str(&json).unwrap();
        assert_eq!(back.code, ADPErrorCode::ServiceTimeout);
        assert_eq!(back.message, "timeout");
        assert_eq!(back.retry_after_ms, Some(750));
        assert!(back.retryable);
        assert_eq!(back.details, Some("upstream slow".to_string()));
    }

    #[test]
    fn error_round_trips_minimal_variant() {
        let err = ADPError::new(ADPErrorCode::WorktreeNotFound, "no worktree");
        let json = serde_json::to_string(&err).unwrap();
        let back: ADPError = serde_json::from_str(&json).unwrap();
        assert_eq!(back.code, ADPErrorCode::WorktreeNotFound);
        assert_eq!(back.message, "no worktree");
        assert_eq!(back.details, None);
        assert_eq!(back.retry_after_ms, None);
        assert!(!back.retryable);
    }

    #[test]
    fn error_clone_is_deep_equal() {
        let err =
            ADPError::retryable(ADPErrorCode::QaCheckTimeout, "qa", 100).with_details("step build");
        let cloned = err.clone();
        assert_eq!(cloned.code, err.code);
        assert_eq!(cloned.message, err.message);
        assert_eq!(cloned.details, err.details);
        assert_eq!(cloned.retry_after_ms, err.retry_after_ms);
        assert_eq!(cloned.retryable, err.retryable);
    }

    #[test]
    fn error_serialized_json_contains_code_and_message_keys() {
        let err = ADPError::new(ADPErrorCode::UnknownEventType, "huh");
        let value: serde_json::Value = serde_json::to_value(&err).unwrap();
        assert_eq!(value["code"], "UNKNOWN_EVENT_TYPE");
        assert_eq!(value["message"], "huh");
    }
}
