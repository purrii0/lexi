from manim import *

class QuadraticEquation(Scene):
    def construct(self):
        # Create objects
        formula = MathTex(r"ax^2 + bx + c = 0").scale(1.5)
        graph = FunctionGraph(lambda x: x**2 + 2*x + 1, x_range=[-10, 10], color=BLUE)
        axis = Axes(x_range=[-10, 10, 2], y_range=[-10, 10, 2], x_length=10, y_length=6, axis_config={"include_tip": False})
        
        # Show caption 1
        caption1 = Text("वर्ग समीकरणको परिचय", font_size=28).to_edge(DOWN)
        self.play(Write(caption1), run_time=3)
        self.wait()
        
        # Show formula
        self.play(FadeOut(caption1))
        self.play(Write(formula))
        self.wait(1)
        
        # Show caption 2
        caption2 = Text("सामान्य रूप: ax^2 + bx + c = 0", font_size=28).to_edge(DOWN)
        self.play(FadeOut(formula))
        self.play(FadeOut(caption2)) # Add this line to fade out caption2 before showing it
        self.play(Write(caption2), run_time=4)
        self.wait(1)
        
        # Animate graph
        self.play(FadeOut(caption2))
        self.play(Create(axis), run_time=1)
        self.play(Create(graph), run_time=2)
        self.wait(1)
        
        # Highlight x-y axis
        self.play(axis.animate.set_color(YELLOW))
        self.wait(1)
        
        # Show caption 3
        caption3 = Text("हल गर्ने तरिकाहरु", font_size=28).to_edge(DOWN)
        self.play(FadeOut(caption2)) # Add this line to fade out caption2 before showing caption3
        self.play(Write(caption3), run_time=5)
        self.wait(2)