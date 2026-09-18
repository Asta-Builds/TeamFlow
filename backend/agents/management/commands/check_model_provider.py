import os
import sys
from django.core.management.base import BaseCommand, CommandError
from django.conf import settings
from agents.llm import generate_text_detailed

class Command(BaseCommand):
    help = "Checks model provider configuration and verifies text generation."

    def add_arguments(self, parser):
        parser.add_argument("--prompt", type=str, default="Reply with the single word OK.")
        parser.add_argument("--timeout", type=int, default=60)

    def execute(self, *args, **options):
        options["traceback"] = True
        return super().execute(*args, **options)

    def handle(self, *args, **options):
        self.stdout.write("1. Configuration:")
        for key in ["GEMINI_API_KEY", "OPENAI_API_KEY", "OLLAMA_BASE_URL"]:
            val = getattr(settings, key, "")
            if val:
                self.stdout.write(f"  {key}: set ({len(val)} chars)")
            else:
                self.stdout.write(f"  {key}: not set")
        
        val_fixture = getattr(settings, "LLM_FIXTURE_DIR", "")
        if val_fixture:
            self.stdout.write(f"  LLM_FIXTURE_DIR: set ({len(val_fixture)} chars)")
        else:
            self.stdout.write("  LLM_FIXTURE_DIR: not set")
            
        self.stdout.write(f"  GEMINI_MODEL: {getattr(settings, 'GEMINI_MODEL', 'not set')}")
        self.stdout.write(f"  OPENAI_MODEL: {getattr(settings, 'OPENAI_MODEL', 'not set')}")
        self.stdout.write(f"  OLLAMA_MODEL: {getattr(settings, 'OLLAMA_MODEL', 'not set')}")

        self.stdout.write("\n2. Antigravity SDK:")
        try:
            import google.antigravity
            self.stdout.write("  Imports: Yes")
            self.stdout.write(f"  Path: {google.antigravity.__file__}")
            
            symbols = []
            for sym in ["Agent", "LocalAgentConfig", "CapabilitiesConfig"]:
                if hasattr(google.antigravity, sym):
                    symbols.append(sym)
            self.stdout.write(f"  Symbols found: {', '.join(symbols) if symbols else 'None'}")
        except ImportError as e:
            self.stdout.write("  Imports: No")
            self.stdout.write(f"  Error: {e}")

        prompt = options["prompt"]
        timeout = options["timeout"]
        system_prompt = "You reply with exactly what is asked, nothing else."
        
        self.stdout.write(f"\n3. Generating text (timeout {timeout}s)...")
        result = generate_text_detailed(system_prompt, prompt, timeout=timeout)
        
        self.stdout.write(f"  Provider: {result.provider}")
        self.stdout.write(f"  Model: {result.model}")
        self.stdout.write(f"  Duration: {result.duration_s:.2f}s")
        self.stdout.write(f"  Attempts: {result.attempts}")
        
        tokens_msg = f"{result.prompt_tokens}/{result.output_tokens}/{result.total_tokens}" if result.total_tokens is not None else "None"
        self.stdout.write(f"  Tokens: {tokens_msg}")
        
        if result.ok:
            text_preview = result.text[:200]
            self.stdout.write(f"  Text: {text_preview!r}")
        else:
            self.stderr.write(f"\n4. Failure: {result.error}")
            # Raising CommandError will cause BaseCommand to print the traceback and exit with 1
            # But the traceback of CommandError is just where it was raised. If there's an exception,
            # we don't have the original traceback unless we let the original exception propagate.
            # But the spec says: "On failure: the LLMResult.error and the full traceback (--traceback behaviour by default here; the whole point of the command is diagnosing a provider that does not work)."
            # I can just raise CommandError and since traceback is True it will print.
            raise CommandError(result.error or "Text generation failed without a specific error.")
