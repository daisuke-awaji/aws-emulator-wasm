//! wasm: telemetry never leaves the browser. A stand-in for the few `reqwest` items the
//! telemetry worker names; every send fails, so no config is fetched and no batch is sent.
#![allow(dead_code)]

pub use http::{header, StatusCode};
pub use url::Url;

pub mod redirect {
    #[derive(Debug, Clone, Copy)]
    pub struct Policy;

    impl Policy {
        pub fn none() -> Self {
            Policy
        }
    }
}

pub mod blocking {
    use std::time::Duration;

    #[derive(Debug)]
    pub struct Error;

    impl std::fmt::Display for Error {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("network is unavailable in the wasm build")
        }
    }

    impl std::error::Error for Error {}

    #[derive(Debug, Clone, Default)]
    pub struct Client;

    #[derive(Debug)]
    pub struct ClientBuilder;

    impl Client {
        pub fn builder() -> ClientBuilder {
            ClientBuilder
        }
        pub fn get<U>(&self, _url: U) -> RequestBuilder {
            RequestBuilder
        }
        pub fn post<U>(&self, _url: U) -> RequestBuilder {
            RequestBuilder
        }
    }

    impl ClientBuilder {
        pub fn connect_timeout(self, _: Duration) -> Self {
            self
        }
        pub fn timeout(self, _: Duration) -> Self {
            self
        }
        pub fn redirect(self, _: super::redirect::Policy) -> Self {
            self
        }
        pub fn build(self) -> Result<Client, Error> {
            Ok(Client)
        }
    }

    #[derive(Debug)]
    pub struct RequestBuilder;

    impl RequestBuilder {
        pub fn header<K, V>(self, _key: K, _value: V) -> Self {
            self
        }
        pub fn body<B>(self, _body: B) -> Self {
            self
        }
        pub fn send(self) -> Result<Response, Error> {
            Err(Error)
        }
    }

    #[derive(Debug)]
    pub struct Response {
        headers: http::HeaderMap,
    }

    impl Response {
        pub fn status(&self) -> http::StatusCode {
            http::StatusCode::SERVICE_UNAVAILABLE
        }
        pub fn headers(&self) -> &http::HeaderMap {
            &self.headers
        }
    }

    impl std::io::Read for Response {
        fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
            Ok(0)
        }
    }
}
