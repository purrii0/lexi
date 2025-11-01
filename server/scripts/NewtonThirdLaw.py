from manim import *

class NewtonThirdLaw(Scene):
    def construct(self):
        # Create objects
        ball = Circle(radius=0.5, color=BLUE, fill_opacity=1).shift(LEFT * 3)
        wall = Rectangle(width=2, height=6, color=RED, fill_opacity=1).shift(RIGHT * 3)
        arrow = Arrow(start=wall.get_right(), end=wall.get_right() + RIGHT * 2, color=YELLOW, buff=0)
        
        # Add objects to scene
        self.add(ball, wall)
        
        # Show first caption
        caption1 = Text("Action: Ball hits wall", font_size=28).to_edge(DOWN)
        self.play(Write(caption1), run_time=3)
        
        # Ball moves towards wall
        self.play(ball.animate.shift(RIGHT * 6), run_time=2)
        self.play(FadeOut(caption1))
        
        # Ball hits wall
        self.play(ball.animate.set_opacity(0.5))
        self.wait(0.5)
        
        # Show second caption
        caption2 = Text("Reaction: Wall exerts force on ball", font_size=28).to_edge(DOWN)
        self.play(Write(caption2), run_time=3)
        
        # Arrow moves away from wall
        self.add(arrow)
        self.play(arrow.animate.shift(RIGHT * 2), run_time=1)
        self.play(FadeOut(caption2))
        
        # Show third caption
        caption3 = Text("Equal and Opposite Forces", font_size=28).to_edge(DOWN)
        self.play(Write(caption3), run_time=4)
        
        # Wait before ending scene
        self.wait(4)
        self.play(FadeOut(Group(*self.mobjects)))